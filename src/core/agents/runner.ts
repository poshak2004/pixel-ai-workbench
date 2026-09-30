import type { z } from 'zod';
import { CONTRACTS } from '../evaluation/contracts';
import type { GovernanceEngine } from '../governance/engine';
import type { ChatMessage, ModelInfo, ModelRef, ProviderAdapter, ProviderKind, TokenUsage } from '../providers/types';
import { ProviderError } from '../providers/types';
import type { OutputSchemaName } from '../roles/types';
import type { RunJournal } from '../runs/journal';
import type { ToolExecutor, SeatRuntime } from '../tools/executor';
import { toolSpec } from '../tools/types';
import { estimateCost } from '../usage/cost';
import { extractJsonObject, sleep, throwIfAborted } from '../util/runtime';
import { renderSystem, renderUser, type ContextManifest } from './context';

/** Resolves a model reference to a live adapter + metadata. Implemented by the provider manager. */
export interface ModelResolver {
  adapterFor(providerId: string): Promise<ProviderAdapter>;
  modelInfo(ref: ModelRef): Promise<ModelInfo | null>;
  providerKind(providerId: string): Promise<ProviderKind>;
}

/** Running totals for a run, consulted by budget governance before every model call. */
export class RunLedger {
  costUsd = 0;
  tokens = 0;
  add(tokens: number, costUsd: number | null) {
    this.tokens += tokens;
    this.costUsd += costUsd ?? 0;
  }
}

export class GovernanceHaltError extends Error {
  constructor(
    message: string,
    readonly decision: string,
  ) {
    super(message);
    this.name = 'GovernanceHaltError';
  }
}

export interface InvokeInput {
  seat: SeatRuntime;
  manifest: ContextManifest;
  contract: OutputSchemaName;
  phase: string;
  tableId: string | null;
  workflowId: string | null;
  signal?: AbortSignal;
  maxToolRounds?: number;
}

export interface InvokeResult<T> {
  output: T;
  providerId: string;
  model: string;
  tokens: number;
  toolCalls: number;
  latencyMs: number;
  costUsd: number | null;
  attempts: number;
}

const TRANSPORT_RETRIES = 2;

/**
 * Runs one agent turn: context → model → (tools ↔ model)* → contract validation.
 * Governance decides retries for malformed output and gates spend before every call.
 */
export class AgentRunner {
  constructor(
    private readonly resolver: ModelResolver,
    private readonly governance: GovernanceEngine,
    private readonly tools: ToolExecutor,
    private readonly journal: RunJournal,
    private readonly ledger: RunLedger,
  ) {}

  async invoke<N extends OutputSchemaName>(input: InvokeInput): Promise<InvokeResult<z.infer<(typeof CONTRACTS)[N]>>> {
    const { seat, manifest, contract, phase, signal } = input;
    const ref = seat.spec.model;
    const adapter = await this.resolver.adapterFor(ref.providerId);
    const info = await this.resolver.modelInfo(ref);
    const providerKind = await this.resolver.providerKind(ref.providerId);
    const tools = this.tools.toolsFor(seat);
    const maxToolRounds = input.maxToolRounds ?? 6;

    this.journal.event('agent.started', { phase, contract, providerId: ref.providerId, model: ref.modelId, agent: seat.spec.name, role: seat.role.name }, seat.seatId);
    this.journal.event('agent.context', { phase, manifest }, seat.seatId);

    const system = renderSystem(manifest);
    const messages: ChatMessage[] = [{ role: 'user', content: renderUser(manifest) }];
    let tokens = 0;
    let toolCallCount = 0;
    let latencyMs = 0;
    let cost: number | null = 0;
    let servedModel = ref.modelId;

    for (let attempt = 1; ; attempt++) {
      let text = '';
      for (let round = 0; round <= maxToolRounds; round++) {
        throwIfAborted(signal);
        const budget = this.governance.evaluate({ kind: 'model_call', seatId: seat.seatId, roleId: seat.role.id, runCostUsd: this.ledger.costUsd, runTokens: this.ledger.tokens });
        if (budget.decision !== 'ALLOW') {
          this.journal.event('governance.decision', { subject: 'model_call', verdict: budget }, seat.seatId);
          throw new GovernanceHaltError(budget.reason, budget.decision);
        }

        const offerTools = round < maxToolRounds && tools.length > 0 && (info?.capabilities.tools ?? true);
        const started = Date.now();
        const response = await this.completeWithRetry(adapter, {
          model: ref.modelId,
          system,
          messages,
          tools: offerTools ? tools.map(toolSpec) : undefined,
          responseFormat: { type: 'json', name: contract },
          maxTokens: seat.spec.maxOutputTokens,
          signal,
        }, seat.seatId);
        const elapsed = Date.now() - started;
        latencyMs += elapsed;
        servedModel = response.model;

        const est = estimateCost(response.usage, info?.pricing ?? null);
        cost = cost === null || est.costUsd === null ? null : cost + est.costUsd;
        const callTokens = response.usage.inputTokens + response.usage.outputTokens;
        tokens += callTokens;
        this.ledger.add(callTokens, est.costUsd);
        this.recordUsage(seat, input, providerKind, response.usage, response.toolCalls.length, elapsed, est.costUsd, est.source);

        if (response.toolCalls.length === 0 || !offerTools) {
          text = response.text;
          break;
        }
        messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls, providerPayload: response.providerPayload });
        for (const call of response.toolCalls) {
          toolCallCount++;
          const outcome = await this.tools.execute(call, seat, signal);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: outcome.content, isError: outcome.isError });
        }
      }

      const validation = validateContract(contract, text);
      if (validation.ok) {
        this.journal.event('agent.output', { phase, contract, output: validation.value, model: servedModel, tokens, latencyMs, toolCalls: toolCallCount, attempts: attempt }, seat.seatId);
        return {
          output: validation.value as z.infer<(typeof CONTRACTS)[N]>,
          providerId: ref.providerId,
          model: servedModel,
          tokens,
          toolCalls: toolCallCount,
          latencyMs,
          costUsd: cost,
          attempts: attempt,
        };
      }

      const verdict = this.governance.evaluate({ kind: 'agent_output', seatId: seat.seatId, roleId: seat.role.id, valid: false, attempt, error: validation.error });
      this.journal.event('governance.decision', { subject: 'agent_output', phase, verdict }, seat.seatId);
      if (verdict.decision !== 'RETRY') {
        throw new GovernanceHaltError(`${seat.spec.name}: ${verdict.reason}`, verdict.decision);
      }
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `Your previous reply did not satisfy the OUTPUT CONTRACT (${validation.error}). Reply again with exactly one JSON object matching the contract and nothing else.`,
      });
    }
  }

  private async completeWithRetry(adapter: ProviderAdapter, req: Parameters<ProviderAdapter['complete']>[0], seatId: string) {
    for (let i = 0; ; i++) {
      try {
        return await adapter.complete(req);
      } catch (err) {
        const retryable = err instanceof ProviderError && err.retryable && i < TRANSPORT_RETRIES;
        this.journal.event('agent.error', { message: (err as Error).message, retrying: retryable }, seatId);
        if (!retryable) throw err;
        await sleep(400 * (i + 1), req.signal);
      }
    }
  }

  private recordUsage(
    seat: SeatRuntime,
    input: InvokeInput,
    providerKind: ProviderKind,
    usage: TokenUsage,
    toolCalls: number,
    latencyMs: number,
    costUsd: number | null,
    pricingSource: ReturnType<typeof estimateCost>['source'],
  ) {
    const rec = this.journal.usage({
      seatId: seat.seatId,
      agentName: seat.spec.name,
      tableId: input.tableId,
      workflowId: input.workflowId,
      providerId: seat.spec.model.providerId,
      providerKind,
      modelId: seat.spec.model.modelId,
      phase: input.phase,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
      toolCalls,
      latencyMs,
      costUsd,
      providerCostUsd: usage.providerCostUsd ?? null,
      pricingSource: pricingSource === null ? null : pricingSource,
    });
    this.journal.event('model.call', { usage: rec }, seat.seatId);
  }
}

export function validateContract(contract: OutputSchemaName, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const parsed = CONTRACTS[contract].safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: parsed.data };
}

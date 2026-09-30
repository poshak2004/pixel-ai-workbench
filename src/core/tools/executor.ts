import type { AgentSpec } from '../agents/types';
import type { ApprovalGate } from '../governance/approvals';
import type { GovernanceEngine } from '../governance/engine';
import type { ToolCallRequest } from '../providers/types';
import type { Role } from '../roles/types';
import type { RunJournal } from '../runs/journal';
import { checkPermission, type PermissionGrant } from '../security/permissions';
import type { ToolRegistry, Tool } from './types';

export interface SeatRuntime {
  seatId: string;
  role: Role;
  spec: AgentSpec;
  grant: PermissionGrant;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * The only path from an agent's tool request to local execution.
 * Order: known tool → offered to this seat → valid args → permission + governance → (approval) → run.
 * Reasoning never touches the machine directly.
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly governance: GovernanceEngine,
    private readonly approvals: ApprovalGate,
    private readonly journal: RunJournal,
    private readonly root: string | null,
  ) {}

  /** Tools a seat may be offered: in its allow-list and registered. Permission is checked at call time. */
  toolsFor(seat: SeatRuntime): Tool<any>[] {
    return seat.spec.allowedTools.map((n) => this.registry.get(n)).filter((t): t is Tool<any> => !!t);
  }

  async execute(call: ToolCallRequest, seat: SeatRuntime, signal?: AbortSignal): Promise<ToolOutcome> {
    const started = Date.now();
    const tool = this.registry.get(call.name);
    if (!tool || !seat.spec.allowedTools.includes(call.name)) {
      this.journal.event('tool.result', { tool: call.name, status: 'blocked', message: 'Tool not available to this seat' }, seat.seatId);
      return { content: `Tool ${call.name} is not available to you.`, isError: true };
    }

    const parsed = tool.input.safeParse(call.arguments);
    if (!parsed.success) {
      const message = `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
      this.journal.event('tool.result', { tool: call.name, status: 'error', message }, seat.seatId);
      return { content: message, isError: true };
    }
    const args = parsed.data as Record<string, unknown>;

    let paths: string[];
    try {
      paths = await tool.paths(args, { root: this.root, signal });
    } catch (err) {
      return this.finish(seat, tool, args, 'BLOCK', 'blocked', `Blocked: ${(err as Error).message}`, started, true);
    }

    const permission = checkPermission(seat.grant, tool.actionKind);
    const verdict = this.governance.evaluate({
      kind: 'tool_call',
      tool: tool.name,
      actionKind: tool.actionKind,
      seatId: seat.seatId,
      roleId: seat.role.id,
      paths,
      permission,
      constitution: { allowed: seat.role.constitution.allowedActions, forbidden: seat.role.constitution.forbiddenActions },
    });
    this.journal.event('tool.requested', { tool: tool.name, actionKind: tool.actionKind, args, paths }, seat.seatId);
    this.journal.event('governance.decision', { subject: 'tool_call', tool: tool.name, verdict }, seat.seatId);

    if (verdict.decision === 'ESCALATE') {
      const request = { runId: this.journal.runId, seatId: seat.seatId, kind: 'tool_call' as const, title: `${seat.spec.name} wants to run ${tool.name}`, reason: verdict.reason, detail: { tool: tool.name, args, paths } };
      this.journal.event('approval.requested', { request }, seat.seatId);
      const resolution = await this.approvals.request(request, signal);
      this.journal.event('approval.resolved', { kind: 'tool_call', tool: tool.name, resolution }, seat.seatId);
      if (resolution.decision !== 'approved') {
        return this.finish(seat, tool, args, verdict.decision, 'denied_by_human', `Denied by ${resolution.by}${resolution.note ? `: ${resolution.note}` : ''}`, started, true);
      }
    } else if (verdict.decision !== 'ALLOW') {
      return this.finish(seat, tool, args, verdict.decision, 'blocked', `Blocked by governance (${verdict.decidingLayer}): ${verdict.reason}`, started, true);
    }

    try {
      const output = await tool.run(args, { root: this.root, signal });
      return this.finish(seat, tool, args, verdict.decision, 'ok', output, started, false);
    } catch (err) {
      return this.finish(seat, tool, args, verdict.decision, 'error', `Error: ${(err as Error).message}`, started, true);
    }
  }

  private finish(
    seat: SeatRuntime,
    tool: Tool<any>,
    args: Record<string, unknown>,
    decision: Parameters<RunJournal['toolCall']>[0]['governanceDecision'],
    status: Parameters<RunJournal['toolCall']>[0]['status'],
    content: string,
    started: number,
    isError: boolean,
  ): ToolOutcome {
    const durationMs = Date.now() - started;
    this.journal.toolCall({ seatId: seat.seatId, tool: tool.name, actionKind: tool.actionKind, args, status, governanceDecision: decision, resultPreview: content.slice(0, 2000), durationMs });
    this.journal.event('tool.result', { tool: tool.name, status, durationMs, preview: content.slice(0, 2000) }, seat.seatId);
    return { content: this.journal.redact(content), isError };
  }
}

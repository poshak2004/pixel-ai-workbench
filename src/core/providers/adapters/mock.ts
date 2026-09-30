import { readSection, readSections } from '../../agents/context';
import { estimateTokens, sha256, sleep } from '../../util/runtime';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  ProviderAdapter,
  ProviderConfig,
  ProviderDeps,
  ProviderFactory,
  ToolCallRequest,
} from '../types';

/**
 * Deterministic demo providers. They implement the same ProviderAdapter contract as real providers
 * and derive every answer solely from the request (system prompt, messages, offered tools) — so the
 * whole runtime (tool loop, contracts, retries, governance, usage) is exercised exactly as with a real model.
 */

export type MockPersona = 'atlas' | 'borealis' | 'cirrus';

interface PersonaSpec {
  label: string;
  latencyMs: number;
  confidenceBias: number;
  /** Terse personas omit evidence on objections — useful to exercise evidence standards. */
  terse: boolean;
  models: { id: string; name: string; context: number; input: number; output: number }[];
}

export const PERSONAS: Record<MockPersona, PersonaSpec> = {
  atlas: {
    label: 'Atlas',
    latencyMs: 650,
    confidenceBias: 0.08,
    terse: false,
    models: [
      { id: 'atlas-large', name: 'Atlas Large', context: 400_000, input: 3, output: 15 },
      { id: 'atlas-mini', name: 'Atlas Mini', context: 200_000, input: 0.4, output: 1.6 },
    ],
  },
  borealis: {
    label: 'Borealis',
    latencyMs: 900,
    confidenceBias: -0.04,
    terse: false,
    models: [{ id: 'borealis-pro', name: 'Borealis Pro', context: 1_000_000, input: 2.5, output: 10 }],
  },
  cirrus: {
    label: 'Cirrus',
    latencyMs: 300,
    confidenceBias: 0,
    terse: true,
    models: [{ id: 'cirrus-7b-local', name: 'Cirrus 7B (local)', context: 32_000, input: 0, output: 0 }],
  },
};

export class MockAdapter implements ProviderAdapter {
  private readonly persona: MockPersona;
  private readonly spec: PersonaSpec;

  constructor(
    readonly config: ProviderConfig,
    private readonly deps: ProviderDeps,
  ) {
    const p = String(config.options.persona ?? 'atlas') as MockPersona;
    this.persona = p in PERSONAS ? p : 'atlas';
    this.spec = PERSONAS[this.persona];
  }

  async testConnection() {
    return { ok: true, message: `Demo provider (${this.spec.label}) — deterministic, offline`, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.spec.models.map((m) => ({
      id: m.id,
      providerId: this.config.id,
      displayName: m.name,
      contextWindow: m.context,
      maxOutputTokens: 8192,
      capabilities: { tools: true, vision: false, jsonMode: true, streaming: false, reasoning: false },
      pricing: { inputPerMTok: m.input, outputPerMTok: m.output, source: 'mock' },
    }));
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (!this.spec.models.some((m) => m.id === req.model)) {
      throw new Error(`Model ${req.model} is not served by ${this.config.name}`);
    }
    const ctx = parseRequest(req, this.persona);
    const toolCall = planToolCall(req, ctx);
    const inputTokens = estimateTokens(req.system + req.messages.map(messageText).join('\n'));
    if (toolCall) {
      await this.delay(0.3, req.signal);
      return { text: '', toolCalls: [toolCall], stopReason: 'tool_use', usage: { inputTokens, outputTokens: 24 }, model: req.model };
    }
    const payload = respond(ctx, this.spec);
    const text = JSON.stringify(payload, null, 2);
    const outputTokens = estimateTokens(text);
    await this.delay(1 + outputTokens / 400, req.signal);
    return { text, toolCalls: [], stopReason: 'end', usage: { inputTokens, outputTokens }, model: req.model };
  }

  private delay(factor: number, signal?: AbortSignal) {
    const scale = typeof this.config.options.latencyScale === 'number' ? this.config.options.latencyScale : (this.deps.latencyScale ?? 1);
    return sleep(Math.round(this.spec.latencyMs * factor * scale), signal);
  }
}

function messageText(m: ChatMessage): string {
  return m.content;
}

// ── Request understanding ─────────────────────────────────────────────────────────────

interface MockContext {
  persona: MockPersona;
  contract: string;
  role: string;
  seatId: string;
  task: string;
  topic: string;
  sensitive: boolean;
  destructive: boolean;
  userText: string;
  toolResults: { name: string; content: string }[];
  seed: number;
}

function parseRequest(req: CompletionRequest, persona: MockPersona): MockContext {
  const role = req.system.match(/^ROLE: (.+)$/m)?.[1]?.trim() ?? 'AGENT';
  const firstUser = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const phase = readSection(firstUser, 'PHASE') ?? '';
  const seatId = phase.match(/You are seat (\S+)/)?.[1] ?? 'seat';
  const task = readSection(firstUser, 'TASK') ?? firstUser;
  const toolResults = req.messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool').map((m) => ({ name: m.name, content: m.content }));
  return {
    persona,
    contract: req.responseFormat?.name ?? 'proposal',
    role,
    seatId,
    task,
    topic: summarise(task),
    sensitive: /\b(auth\w*|login|password|token|secret|credential|payment|api key|oauth|session|pii|personal data|encrypt\w*)\b/i.test(task),
    destructive: /\b(delete|drop|wipe|purge|truncate|rm -rf|destroy)\b/i.test(task) && /\b(prod\w*|live|customer|user)\b/i.test(task),
    userText: firstUser,
    toolResults,
    seed: parseInt(sha256(`${persona}|${role}|${task}|${req.model}`).slice(0, 8), 16),
  };
}

function summarise(task: string): string {
  const oneLine = task.replace(/\s+/g, ' ').trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
}

function planToolCall(req: CompletionRequest, ctx: MockContext): ToolCallRequest | null {
  if (ctx.contract !== 'proposal' || !req.tools?.length) return null;
  const has = (n: string) => req.tools!.some((t) => t.name === n);
  const done = ctx.toolResults.length;
  if (done === 0 && has('fs_list_dir')) return { id: `mock_call_${ctx.seed % 997}_1`, name: 'fs_list_dir', arguments: { path: '.' } };
  if (done === 1 && has('fs_read_file')) {
    const listing = ctx.toolResults[0]!.content;
    const target = ['README.md', 'package.json', 'pyproject.toml', 'Cargo.toml'].find((f) => new RegExp(`file\\s+${f.replace('.', '\\.')}$`, 'm').test(listing));
    if (target) return { id: `mock_call_${ctx.seed % 997}_2`, name: 'fs_read_file', arguments: { path: target } };
  }
  return null;
}

function jsonBlocks(section: string): unknown[] {
  const out: unknown[] = [];
  for (const m of section.matchAll(/```json\s*([\s\S]*?)```/g)) {
    try {
      out.push(JSON.parse(m[1]!));
    } catch {
      /* ignore */
    }
  }
  return out;
}

function clamp(n: number) {
  return Math.max(0.05, Math.min(0.97, Math.round(n * 100) / 100));
}

function pick<T>(items: T[], seed: number): T {
  return items[seed % items.length]!;
}

// ── Responses per contract ───────────────────────────────────────────────────────────

function respond(ctx: MockContext, spec: PersonaSpec): unknown {
  switch (ctx.contract) {
    case 'proposal':
      return proposal(ctx, spec);
    case 'review':
      return review(ctx, spec);
    case 'rebuttal':
      return rebuttal(ctx);
    case 'resolution':
      return resolution(ctx);
    case 'adjudication':
      return adjudication(ctx, spec);
    default:
      return { error: 'unknown contract' };
  }
}

function workspaceEvidence(ctx: MockContext) {
  const ev: { source: string; detail: string }[] = [];
  const listing = ctx.toolResults.find((t) => t.name === 'fs_list_dir');
  if (listing && !listing.content.startsWith('Blocked') && !listing.content.startsWith('Error')) {
    const entries = listing.content.split('\n').filter(Boolean);
    ev.push({ source: 'fs_list_dir .', detail: `Workspace has ${entries.length} top-level entries (${entries.slice(0, 4).map((e) => e.replace(/^(dir|file)\s+/, '')).join(', ')}${entries.length > 4 ? ', …' : ''}).` });
  }
  const file = ctx.toolResults.find((t) => t.name === 'fs_read_file');
  if (file && !file.content.startsWith('Blocked') && !file.content.startsWith('Error')) {
    const first = file.content.split('\n').find((l) => l.trim()) ?? '';
    ev.push({ source: 'fs_read_file', detail: `Project descriptor begins: "${first.slice(0, 80)}".` });
  }
  return ev;
}

function proposal(ctx: MockContext, spec: PersonaSpec) {
  const r = ctx.role;
  const ev = [...workspaceEvidence(ctx), { source: 'task statement', detail: `Scope as stated: "${ctx.topic}".` }];
  const risks = [
    { risk: 'Scope creep beyond the stated task', mitigation: 'Freeze acceptance criteria before implementation.' },
    ...(ctx.sensitive ? [{ risk: 'Credential or session data exposure', mitigation: 'Keep secrets in the OS keychain; never log tokens; rotate on compromise.' }] : []),
    ...(ctx.destructive ? [{ risk: 'Irreversible data loss', mitigation: 'Dry-run the selection and export a snapshot first.' }] : []),
  ];
  const base = 0.72 + spec.confidenceBias + ((ctx.seed % 9) - 4) / 100;

  if (/ARCHITECT/.test(r)) {
    return {
      summary: `Layered design for: ${ctx.topic}`,
      approach: `Separate the problem into a thin interface layer, a pure domain core and adapters for I/O. ${pick(['Keep the core synchronous and deterministic so it can be tested exhaustively.', 'Route every side effect through one gateway so it can be audited and rolled back.', 'Define contracts first, then implement behind them.'], ctx.seed)}`,
      steps: ['Write down the contracts and invariants', 'Implement the domain core with unit tests', 'Add adapters behind interfaces', 'Wire the interface layer', 'Add an end-to-end check of the primary path'],
      assumptions: ['Existing behaviour must remain backwards compatible', 'The change can ship behind a flag'],
      risks,
      evidence: ev,
      confidence: clamp(base),
    };
  }
  if (/ENGINEER|EXECUTOR/.test(r)) {
    return {
      summary: `Smallest correct change for: ${ctx.topic}`,
      approach: 'Implement incrementally in small, reversible commits, each with a failing test first. Prefer existing modules over new dependencies.',
      steps: ['Reproduce or specify expected behaviour as a test', 'Implement the minimal change', 'Run the full test suite', 'Checkpoint the worktree'],
      assumptions: ['A test harness exists or can be added cheaply'],
      risks,
      evidence: ev,
      confidence: clamp(base - 0.03),
    };
  }
  return {
    summary: `${titleCase(r)} perspective on: ${ctx.topic}`,
    approach: `Address the task through the lens of the ${titleCase(r)} role: clarify goals, enumerate options, recommend one with explicit trade-offs.`,
    steps: ['Clarify the goal and constraints', 'List options', 'Recommend and justify'],
    assumptions: ['The task statement is complete'],
    risks,
    evidence: ev,
    confidence: clamp(base - 0.05),
  };
}

interface PeerProposal {
  seatId: string;
  role?: string;
  summary?: string;
  steps?: string[];
  risks?: { risk: string }[];
  evidence?: unknown[];
  confidence?: number;
}

function review(ctx: MockContext, spec: PersonaSpec) {
  const proposals = readSections(ctx.userText, 'PEER WORK').flatMap(jsonBlocks) as PeerProposal[];
  const targets = ctx.userText.match(/targetSeatIds: ([^\n.]+)/)?.[1]?.split(',').map((s) => s.trim()) ?? proposals.map((p) => p.seatId);
  const r = ctx.role;
  return {
    reviews: targets.map((target, i) => {
      const p = proposals.find((x) => x.seatId === target) ?? { seatId: target };
      const riskText = (p.risks ?? []).map((x) => x.risk.toLowerCase()).join(' ');
      const conf = clamp(0.7 + spec.confidenceBias - i * 0.02);
      const evidenceFor = (claim: string) => (spec.terse ? [] : [claim]);

      if (/SECURITY/.test(r)) {
        const severity = ctx.sensitive || ctx.destructive ? 'critical' : /scope/.test(riskText) ? 'minor' : 'info';
        return {
          targetSeatId: target,
          verdict: severity === 'critical' ? 'request_evidence' : 'approve',
          summary: severity === 'critical' ? 'Security-relevant change lacks a threat model.' : 'No blocking security issue found; minor hardening suggested.',
          confidence: conf,
          evidence: [{ source: `proposal:${target}.risks`, detail: `Lists ${(p.risks ?? []).length} risk(s).` }],
          challenges: [
            {
              claim: ctx.destructive
                ? 'Deleting production records is irreversible and no verified backup or restore drill is specified.'
                : ctx.sensitive
                  ? 'No threat model: token/credential handling, storage and rotation are not specified.'
                  : 'Input validation boundaries are not specified.',
              severity,
              evidence: [`proposal ${target} steps: ${(p.steps ?? []).length}; none name a security control`],
              question: 'Which control prevents this, and how is it verified?',
            },
          ],
        };
      }
      if (/CRITIC|FACT CHECKER|TESTER/.test(r)) {
        const weak = (p.steps ?? []).length < 4 || (p.evidence ?? []).length < 2;
        return {
          targetSeatId: target,
          verdict: weak ? 'reject' : 'approve',
          summary: weak ? 'Plan is under-specified: verification is missing.' : 'Plan is concrete and verifiable.',
          confidence: conf,
          evidence: [{ source: `proposal:${target}.steps`, detail: `${(p.steps ?? []).length} steps, ${(p.evidence ?? []).length} evidence items.` }],
          challenges: weak
            ? [{ claim: 'Steps do not state how success is verified.', severity: 'major', evidence: evidenceFor(`proposal ${target} has ${(p.steps ?? []).length} steps and no test step`) }]
            : [{ claim: 'Rollback path is implicit.', severity: 'minor', evidence: [] }],
        };
      }
      if (/CONTRARIAN|DEVIL/.test(r)) {
        return {
          targetSeatId: target,
          verdict: 'reject',
          summary: 'A simpler alternative was not considered.',
          confidence: clamp(conf - 0.1),
          evidence: [],
          challenges: [{ claim: 'The proposal assumes a new layer is needed; the existing structure may suffice.', severity: 'major', evidence: evidenceFor(`proposal ${target} assumptions are untested`) }],
        };
      }
      return {
        targetSeatId: target,
        verdict: 'approve',
        summary: `Sound overall; ${pick(['sequencing could be tighter', 'assumptions should be validated early', 'naming of steps could be clearer'], ctx.seed + i)}.`,
        confidence: conf,
        evidence: [{ source: `proposal:${target}`, detail: `Confidence ${(p.confidence ?? 0).toFixed(2)} with ${(p.evidence ?? []).length} evidence item(s).` }],
        challenges: [{ claim: 'Assumptions are stated but not validated.', severity: 'minor', evidence: [] }],
      };
    }),
  };
}

function rebuttal(ctx: MockContext) {
  const section = readSection(ctx.userText, 'PEER WORK: CHALLENGES') ?? '';
  const challenges = (jsonBlocks(section)[0] ?? []) as { challengeId: string; severity: string; claim: string }[];
  return {
    responses: challenges.map((c) => {
      if (c.severity === 'minor' || c.severity === 'info') {
        return { challengeId: c.challengeId, stance: 'concede', response: 'Accepted; will address during implementation.', evidence: [] };
      }
      if (ctx.destructive && /irreversible|backup/i.test(c.claim)) {
        return { challengeId: c.challengeId, stance: 'dispute', response: 'The records are obsolete, so a backup is unnecessary.', evidence: [] };
      }
      return {
        challengeId: c.challengeId,
        stance: 'mitigate',
        response: /threat|credential|token/i.test(c.claim)
          ? 'Adding a threat-model step: secrets stay in the OS keychain, tokens are short-lived and rotated, and every access path is covered by a test.'
          : 'Adding explicit verification: each step now has an acceptance test and a rollback checkpoint.',
        evidence: ['Revised step list includes a verification item per step', 'Rollback via worktree checkpoint'],
      };
    }),
  };
}

function resolution(ctx: MockContext) {
  const section = readSection(ctx.userText, 'PEER WORK: YOUR CHALLENGES') ?? '';
  const items = (jsonBlocks(section)[0] ?? []) as { challengeId: string; claim: string; rebuttal?: { stance: string; evidence?: string[] } }[];
  return {
    resolutions: items.map((c) => {
      const mitigated = c.rebuttal?.stance === 'mitigate' && (c.rebuttal.evidence?.length ?? 0) > 0;
      if (mitigated) return { challengeId: c.challengeId, outcome: 'resolved', reason: 'The mitigation is concrete and verifiable.' };
      return { challengeId: c.challengeId, outcome: 'unresolved', reason: 'The response asserts rather than evidences; the risk stands.' };
    }),
  };
}

function adjudication(ctx: MockContext, spec: PersonaSpec) {
  const proposals = readSections(ctx.userText, 'PEER WORK').flatMap(jsonBlocks).filter((b): b is PeerProposal => !!b && typeof b === 'object' && 'seatId' in b);
  const challenges = (jsonBlocks(readSection(ctx.userText, 'PEER WORK: CHALLENGES') ?? '')[0] ?? []) as { target: string; severity: string; status: string; supported: boolean; claim: string }[];
  const reviews = (jsonBlocks(readSection(ctx.userText, 'PEER WORK: REVIEWS') ?? '')[0] ?? []) as { target: string; verdict: string }[];

  const scored = proposals
    .map((p) => {
      const open = challenges.filter((c) => c.target === p.seatId && c.status !== 'resolved' && c.supported && (c.severity === 'major' || c.severity === 'critical'));
      const approvals = reviews.filter((r) => r.target === p.seatId && r.verdict === 'approve').length;
      return { p, open, score: (p.confidence ?? 0.5) - 0.12 * open.length + 0.03 * approvals };
    })
    .sort((a, b) => b.score - a.score || a.p.seatId.localeCompare(b.p.seatId));
  const best = scored[0];
  if (!best) {
    return { decision: 'escalate', selectedSeatId: null, rationale: 'No proposals were available to adjudicate.', findings: [], evidence: [{ source: 'run', detail: 'zero proposals' }], confidence: 0.2, finalAnswer: 'No result: escalated for human review.' };
  }
  const decision = best.score >= 0.45 ? 'approve' : 'revise';
  const resolved = challenges.filter((c) => c.target === best.p.seatId && c.status === 'resolved');
  return {
    decision,
    selectedSeatId: best.p.seatId,
    rationale: `${best.p.seatId} (${best.p.role ?? 'seat'}) offers the best-supported approach: ${best.open.length} open material challenge(s), ${resolved.length} resolved through rebuttal.`,
    findings: [
      { claim: best.p.summary ?? 'Selected proposal', assessment: best.open.length ? 'contested' : 'supported', note: best.open.map((c) => c.claim).join(' ') },
      ...scored.slice(1).map((s) => ({ claim: s.p.summary ?? s.p.seatId, assessment: 'contested' as const, note: `Scored lower (${s.score.toFixed(2)} vs ${best.score.toFixed(2)}).` })),
    ],
    evidence: [
      { source: `proposal:${best.p.seatId}`, detail: `Self-reported confidence ${(best.p.confidence ?? 0).toFixed(2)}; ${(best.p.evidence ?? []).length} evidence item(s).` },
      { source: 'reviews', detail: `${reviews.filter((r) => r.target === best.p.seatId && r.verdict === 'approve').length} approval(s) of ${reviews.filter((r) => r.target === best.p.seatId).length} review(s).` },
    ],
    confidence: clamp(best.score + spec.confidenceBias / 2),
    finalAnswer: [
      `**Recommendation:** ${best.p.summary ?? ''}`,
      '',
      ...(best.p.steps ?? []).map((s, i) => `${i + 1}. ${s}`),
      ...(resolved.length ? ['', '**Incorporated mitigations:**', ...resolved.map((c) => `- ${c.claim}`)] : []),
      ...(best.open.length ? ['', '**Open concerns:**', ...best.open.map((c) => `- (${c.severity}) ${c.claim}`)] : []),
    ].join('\n'),
  };
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const mockFactory: ProviderFactory = {
  kind: 'mock',
  label: 'Demo (offline)',
  authKind: 'none',
  description: 'Deterministic offline providers for demo mode and tests. No network, no keys.',
  create: (config, _secret, deps) => new MockAdapter(config, deps),
};

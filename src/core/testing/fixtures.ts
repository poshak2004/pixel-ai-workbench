import type { ModelResolver } from '../agents/runner';
import type { AgentSpec } from '../agents/types';
import { SAFETY_POLICY, SYSTEM_POLICY } from '../governance/defaults';
import type { Policy } from '../governance/types';
import { MockAdapter } from '../providers/adapters/mock';
import type { CompletionRequest, CompletionResponse, ModelInfo, ModelRef, ProviderAdapter, ProviderConfig, ProviderKind } from '../providers/types';
import { BUILT_IN_ROLES } from '../roles/library';
import type { Role } from '../roles/types';
import { RunJournal, MemoryJournalStore } from '../runs/journal';
import { DEFAULT_GRANT, type PermissionGrant } from '../security/permissions';
import { SecretRedactor } from '../security/redaction';
import type { Seat, Table } from '../teams/types';
import { EventBus, type RunEvent } from '../events/types';
import { fixedClock, sequentialIds } from '../util/runtime';

export function mockConfig(id: string, persona: 'atlas' | 'borealis' | 'cirrus'): ProviderConfig {
  return { id, kind: 'mock', name: `Demo ${persona}`, authKind: 'none', enabled: true, options: { persona, latencyScale: 0 }, createdAt: 0 };
}

/** Wraps an adapter and records every request it receives (for independence assertions). */
export class RecordingAdapter implements ProviderAdapter {
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly inner: ProviderAdapter) {}
  get config() {
    return this.inner.config;
  }
  testConnection() {
    return this.inner.testConnection();
  }
  listModels() {
    return this.inner.listModels();
  }
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    return this.inner.complete(req);
  }
}

export class StaticResolver implements ModelResolver {
  constructor(private readonly adapters: Map<string, ProviderAdapter>) {}
  async adapterFor(providerId: string) {
    const a = this.adapters.get(providerId);
    if (!a) throw new Error(`unknown provider ${providerId}`);
    return a;
  }
  async modelInfo(ref: ModelRef): Promise<ModelInfo | null> {
    const models = await (await this.adapterFor(ref.providerId)).listModels();
    return models.find((m) => m.id === ref.modelId) ?? null;
  }
  async providerKind(providerId: string): Promise<ProviderKind> {
    return (await this.adapterFor(providerId)).config.kind;
  }
}

export function demoAdapters() {
  const atlas = new RecordingAdapter(new MockAdapter(mockConfig('p_atlas', 'atlas'), { fetch }));
  const borealis = new RecordingAdapter(new MockAdapter(mockConfig('p_borealis', 'borealis'), { fetch }));
  const cirrus = new RecordingAdapter(new MockAdapter(mockConfig('p_cirrus', 'cirrus'), { fetch }));
  const map = new Map<string, ProviderAdapter>([
    ['p_atlas', atlas],
    ['p_borealis', borealis],
    ['p_cirrus', cirrus],
  ]);
  return { atlas, borealis, cirrus, resolver: new StaticResolver(map), map };
}

export function rolesMap(extra: Role[] = []): Map<string, Role> {
  return new Map([...BUILT_IN_ROLES, ...extra].map((r) => [r.id, r]));
}

export function spec(name: string, roleId: string, model: ModelRef, over: Partial<AgentSpec> = {}): AgentSpec {
  return {
    name,
    roleId,
    objective: '',
    model,
    systemRules: [],
    allowedTools: [],
    permissions: { ...DEFAULT_GRANT },
    memoryPolicy: 'run',
    maxOutputTokens: 4096,
    ...over,
  };
}

export function seat(id: string, order: number, s: AgentSpec, over: Partial<Seat> = {}): Seat {
  return { id, order, spec: s, ...over };
}

/** The canonical vertical-slice council: three workers/reviewers on three providers + a judge. */
export function councilTable(over: Partial<Table> = {}): Table {
  return {
    id: 'tbl_1',
    name: 'Design Council',
    description: '',
    projectId: null,
    seats: [
      seat('architect', 0, spec('Architect', 'role_architect', { providerId: 'p_atlas', modelId: 'atlas-large' })),
      seat('engineer', 1, spec('Engineer', 'role_engineer', { providerId: 'p_cirrus', modelId: 'cirrus-7b-local' })),
      seat('security', 2, spec('Security', 'role_security_reviewer', { providerId: 'p_borealis', modelId: 'borealis-pro' })),
      seat('judge', 3, spec('Judge', 'role_judge', { providerId: 'p_borealis', modelId: 'borealis-pro' })),
    ],
    protocol: {
      critique: true,
      rebuttal: true,
      blindReviews: true,
      requireCrossProviderReview: false,
      evaluation: 'judge_arbitration',
      approvalThreshold: 0.5,
      maxConcurrency: 4,
    },
    rules: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

export function testJournal(runId = 'run_1') {
  const store = new MemoryJournalStore();
  const bus = new EventBus<RunEvent>();
  const redactor = new SecretRedactor();
  const journal = new RunJournal(runId, { store, redactor, bus, clock: fixedClock(), ids: sequentialIds() });
  return { store, bus, redactor, journal };
}

export const BASE_POLICIES: Policy[] = [SAFETY_POLICY, SYSTEM_POLICY];

export const WIDE_GRANT: PermissionGrant = { ...DEFAULT_GRANT, filesystem: 'worktree_write', terminal: 'allowed' };

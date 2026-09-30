import type { AgentSpec } from '../agents/types';
import { SAFETY_POLICY, SYSTEM_POLICY } from '../governance/defaults';
import type { ProviderManager } from '../providers/manager';
import { BUILT_IN_ROLES } from '../roles/library';
import { DEFAULT_GRANT } from '../security/permissions';
import type { PoliciesRepo, RolesRepo, SettingsRepo } from '../storage/repos/definitions';
import type { ProvidersRepo } from '../storage/repos/providers';
import type { Protocol, Seat } from '../teams/types';
import type { Clock } from '../util/runtime';

export const DEMO_PROVIDER_IDS = { atlas: 'prov_demo_atlas', borealis: 'prov_demo_borealis', cirrus: 'prov_demo_cirrus' } as const;

export const DEFAULT_PROTOCOL: Protocol = {
  critique: true,
  rebuttal: true,
  blindReviews: true,
  requireCrossProviderReview: false,
  evaluation: 'judge_arbitration',
  approvalThreshold: 0.5,
  maxConcurrency: 4,
};

/** Idempotent first-run seeding: built-in roles, locked policies, offline demo providers. */
export async function seed(deps: { roles: RolesRepo; policies: PoliciesRepo; providersRepo: ProvidersRepo; providers: ProviderManager; settings: SettingsRepo; clock: Clock }) {
  const now = deps.clock.now();
  // Built-ins are always refreshed to the shipped definition; user customisations live in copies.
  for (const role of BUILT_IN_ROLES) await deps.roles.upsert(role, now);
  for (const p of [SAFETY_POLICY, SYSTEM_POLICY]) await deps.policies.upsert({ ...p, scopeType: 'global', scopeId: null }, now);

  for (const [persona, id] of Object.entries(DEMO_PROVIDER_IDS)) {
    if (await deps.providersRepo.get(id)) continue;
    await deps.providersRepo.upsert({
      id,
      kind: 'mock',
      name: `Demo · ${persona[0]!.toUpperCase()}${persona.slice(1)}`,
      baseUrl: null,
      authKind: 'none',
      enabled: true,
      options: { persona },
      createdAt: now,
    });
    await deps.providers.discover(id);
  }
  if ((await deps.settings.get('onboarded')) === undefined) await deps.settings.set('onboarded', false);
}

function seatSpec(name: string, roleId: string, providerId: string, modelId: string, extra: Partial<AgentSpec> = {}): AgentSpec {
  return { name, roleId, objective: '', model: { providerId, modelId }, systemRules: [], allowedTools: [], permissions: { ...DEFAULT_GRANT }, memoryPolicy: 'run', maxOutputTokens: 4096, ...extra };
}

/** The demo council: three agents on three different providers, plus an independent judge. */
export function demoSeats(): Seat[] {
  return [
    { id: 'architect', order: 0, spec: seatSpec('Architect', 'role_architect', DEMO_PROVIDER_IDS.atlas, 'atlas-large', { allowedTools: ['fs_list_dir', 'fs_read_file'] }) },
    { id: 'engineer', order: 1, spec: seatSpec('Engineer', 'role_engineer', DEMO_PROVIDER_IDS.cirrus, 'cirrus-7b-local', { allowedTools: ['fs_list_dir', 'fs_read_file'] }) },
    { id: 'security', order: 2, spec: seatSpec('Security Reviewer', 'role_security_reviewer', DEMO_PROVIDER_IDS.borealis, 'borealis-pro') },
    { id: 'judge', order: 3, spec: seatSpec('Judge', 'role_judge', DEMO_PROVIDER_IDS.atlas, 'atlas-mini') },
  ];
}

export const TABLE_TEMPLATES: { id: string; name: string; description: string; seats: () => Seat[] }[] = [
  { id: 'design-council', name: 'Design Council', description: 'Architect, Engineer and Security Reviewer on three providers, with an independent Judge.', seats: demoSeats },
  {
    id: 'adversarial-review',
    name: 'Adversarial Review',
    description: 'One Engineer proposes; Critic, Contrarian and Fact Checker attack; a Judge decides.',
    seats: () => [
      { id: 'engineer', order: 0, spec: seatSpec('Engineer', 'role_engineer', DEMO_PROVIDER_IDS.atlas, 'atlas-large') },
      { id: 'critic', order: 1, spec: seatSpec('Critic', 'role_critic', DEMO_PROVIDER_IDS.borealis, 'borealis-pro') },
      { id: 'contrarian', order: 2, spec: seatSpec('Contrarian', 'role_contrarian', DEMO_PROVIDER_IDS.cirrus, 'cirrus-7b-local') },
      { id: 'fact_checker', order: 3, spec: seatSpec('Fact Checker', 'role_fact_checker', DEMO_PROVIDER_IDS.borealis, 'borealis-pro') },
      { id: 'judge', order: 4, spec: seatSpec('Judge', 'role_judge', DEMO_PROVIDER_IDS.atlas, 'atlas-mini') },
    ],
  },
  { id: 'blank', name: 'Blank table', description: 'Start with only a Judge seat and add your own.', seats: () => [{ id: 'judge', order: 0, spec: seatSpec('Judge', 'role_judge', DEMO_PROVIDER_IDS.atlas, 'atlas-mini') }] },
];

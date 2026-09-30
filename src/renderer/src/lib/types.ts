import type { ApiOutput } from './ipc';

export type RunDetail = NonNullable<ApiOutput<'runs.detail'>>;
export type RunEvent = RunDetail['events'][number];
export type RunRecord = RunDetail['run'];
export type Judgment = RunDetail['judgments'][number];
export type UsageRow = RunDetail['usage'][number];
export type Table = NonNullable<ApiOutput<'tables.get'>>;
export type Seat = Table['seats'][number];
export type AgentSpec = Seat['spec'];
export type Role = ApiOutput<'roles.list'>[number];
export type ProviderStatus = ApiOutput<'providers.list'>[number];
export type StoredModel = ApiOutput<'models.list'>[number];
export type Project = ApiOutput<'projects.list'>[number];
export type Workflow = NonNullable<ApiOutput<'workflows.get'>>;
export type WorkflowNode = Workflow['nodes'][number];
export type PermissionGrant = AgentSpec['permissions'];
export type Approval = ApiOutput<'approvals.pending'>[number];

export interface Verdict {
  decision: string;
  decidingLayer: string | null;
  decidingRuleId: string | null;
  reason: string;
  trace: { layer: string; policyId: string; ruleId: string; ruleType: string; outcome: string; message: string }[];
  violations: string[];
  policyHash: string;
}

export interface ContextManifest {
  sections: { kind: string; title: string; source: string; placement: 'system' | 'user'; content: string; tokens: number }[];
  totalTokens: number;
  constitutionHash: string;
}

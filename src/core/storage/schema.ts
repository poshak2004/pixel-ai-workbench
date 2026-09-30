import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AgentSpec } from '../agents/types';
import type { Rule } from '../governance/types';
import type { ModelCapabilities, ModelPricing } from '../providers/types';
import type { Authority, Constitution } from '../roles/types';
import type { PermissionGrant } from '../security/permissions';
import type { Protocol } from '../teams/types';

/**
 * Durable local schema. Secrets are never stored here: `credentials_metadata` holds only a
 * keychain account reference and a non-reversible fingerprint.
 */

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const bool = (name: string) => integer(name, { mode: 'boolean' });

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  baseUrl: text('base_url'),
  authKind: text('auth_kind').notNull(),
  enabled: bool('enabled').notNull().default(true),
  options: json<Record<string, unknown>>('options').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const credentialsMetadata = sqliteTable('credentials_metadata', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  backend: text('backend').notNull(),
  account: text('account').notNull(),
  fingerprint: text('fingerprint').notNull(),
  createdAt: integer('created_at').notNull(),
  lastVerifiedAt: integer('last_verified_at'),
  lastStatus: text('last_status'),
}, (t) => [uniqueIndex('credentials_provider_idx').on(t.providerId)]);

export const models = sqliteTable('models', {
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  displayName: text('display_name').notNull(),
  contextWindow: integer('context_window'),
  maxOutputTokens: integer('max_output_tokens'),
  capabilities: json<ModelCapabilities>('capabilities').notNull(),
  pricing: json<ModelPricing | null>('pricing'),
  userPricing: json<ModelPricing | null>('user_pricing'),
  discoveredAt: integer('discovered_at').notNull(),
}, (t) => [primaryKey({ columns: [t.providerId, t.modelId] })]);

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  constitution: json<Constitution>('constitution').notNull(),
  builtIn: bool('built_in').notNull(),
  version: integer('version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  roleId: text('role_id').notNull(),
  spec: json<AgentSpec>('spec').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  path: text('path'),
  isGit: bool('is_git').notNull().default(false),
  budgetUsd: real('budget_usd').notNull().default(5),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const tables = sqliteTable('tables', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  protocol: json<Protocol>('protocol').notNull(),
  rules: json<Rule[]>('rules').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Seats of a table (its members). */
export const tableMembers = sqliteTable('table_members', {
  id: text('id').primaryKey(),
  tableId: text('table_id').notNull().references(() => tables.id, { onDelete: 'cascade' }),
  ord: integer('ord').notNull(),
  spec: json<AgentSpec>('spec').notNull(),
  authority: json<Partial<Authority> | null>('authority'),
  sourceAgentId: text('source_agent_id'),
}, (t) => [index('table_members_table_idx').on(t.tableId)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  tableId: text('table_id'),
  workflowId: text('workflow_id'),
  parentRunId: text('parent_run_id'),
  title: text('title').notNull(),
  task: text('task').notNull(),
  status: text('status').notNull(),
  outcome: text('outcome'),
  /** Immutable snapshot of table, roles and policies at launch — enables exact replay. */
  snapshot: json<Record<string, unknown>>('snapshot').notNull(),
  workspacePath: text('workspace_path'),
  branch: text('branch'),
  error: text('error'),
  lastSeq: integer('last_seq').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
}, (t) => [index('runs_project_idx').on(t.projectId), index('runs_created_idx').on(t.createdAt)]);

/** Per-run seat instances (which agent sat where, on which model, with which constitution hash). */
export const agentSeats = sqliteTable('agent_seats', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seatId: text('seat_id').notNull(),
  name: text('name').notNull(),
  roleId: text('role_id').notNull(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  constitutionHash: text('constitution_hash').notNull(),
  authority: json<Authority>('authority').notNull(),
}, (t) => [index('agent_seats_run_idx').on(t.runId)]);

export const runEvents = sqliteTable('run_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  ts: integer('ts').notNull(),
  type: text('type').notNull(),
  seatId: text('seat_id'),
  payload: json<Record<string, unknown>>('payload').notNull(),
}, (t) => [uniqueIndex('run_events_run_seq_idx').on(t.runId, t.seq)]);

export const toolCalls = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seatId: text('seat_id').notNull(),
  tool: text('tool').notNull(),
  actionKind: text('action_kind').notNull(),
  args: json<Record<string, unknown>>('args').notNull(),
  status: text('status').notNull(),
  governanceDecision: text('governance_decision').notNull(),
  resultPreview: text('result_preview').notNull(),
  durationMs: integer('duration_ms').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('tool_calls_run_idx').on(t.runId)]);

export const judgments = sqliteTable('judgments', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  judgeSeatId: text('judge_seat_id').notNull(),
  targetSeatId: text('target_seat_id'),
  challengeId: text('challenge_id'),
  claim: text('claim').notNull(),
  evidence: json<string[]>('evidence').notNull(),
  reasoningSummary: text('reasoning_summary').notNull(),
  confidence: real('confidence'),
  decision: text('decision').notNull(),
  severity: text('severity'),
  providerId: text('provider_id').notNull(),
  model: text('model').notNull(),
  tokens: integer('tokens').notNull(),
  toolCalls: integer('tool_calls').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('judgments_run_idx').on(t.runId)]);

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seatId: text('seat_id'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  mimeType: text('mime_type').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('artifacts_run_idx').on(t.runId)]);

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seatId: text('seat_id'),
  agentName: text('agent_name').notNull(),
  tableId: text('table_id'),
  workflowId: text('workflow_id'),
  providerId: text('provider_id').notNull(),
  providerKind: text('provider_kind').notNull(),
  modelId: text('model_id').notNull(),
  phase: text('phase').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  cachedInputTokens: integer('cached_input_tokens').notNull(),
  reasoningTokens: integer('reasoning_tokens').notNull(),
  toolCalls: integer('tool_calls').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  costUsd: real('cost_usd'),
  providerCostUsd: real('provider_cost_usd'),
  pricingSource: text('pricing_source'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('usage_run_idx').on(t.runId), index('usage_created_idx').on(t.createdAt)]);

export const governancePolicies = sqliteTable('governance_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  layer: text('layer').notNull(),
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id'),
  rules: json<Rule[]>('rules').notNull(),
  locked: bool('locked').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  grant: json<PermissionGrant>('grant').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('permissions_subject_idx').on(t.subjectType, t.subjectId)]);

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seatId: text('seat_id'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  reason: text('reason').notNull(),
  detail: json<Record<string, unknown>>('detail').notNull(),
  status: text('status').notNull(),
  resolvedBy: text('resolved_by'),
  note: text('note'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
}, (t) => [index('approvals_status_idx').on(t.status)]);

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const workflowNodes = sqliteTable('workflow_nodes', {
  id: text('id').notNull(),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  label: text('label').notNull(),
  config: json<Record<string, unknown>>('config').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
}, (t) => [primaryKey({ columns: [t.workflowId, t.id] })]);

export const workflowEdges = sqliteTable('workflow_edges', {
  id: text('id').notNull(),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  target: text('target').notNull(),
  /** For CONDITION nodes: which branch ("true"/"false"); otherwise null. */
  branch: text('branch'),
}, (t) => [primaryKey({ columns: [t.workflowId, t.id] })]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
});

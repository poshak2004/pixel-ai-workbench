import { z } from 'zod';
import { AgentSpecSchema } from '@core/agents/types';
import type { PixelApp } from '@core/app/pixel';
import { TableUpdateSchema } from '@core/app/services';
import { RuleSchema, LayerSchema } from '@core/governance/types';
import { ModelRefSchema } from '@core/agents/types';
import { ProjectInputSchema } from '@core/projects/types';
import { ConstitutionSchema } from '@core/roles/types';
import { PermissionGrantSchema } from '@core/security/permissions';
import { WorkflowEdgeSchema, WorkflowNodeSchema } from '@core/workflows/types';
import { McpServerInputSchema } from '@core/mcp/manager';

/**
 * The complete renderer ↔ main contract. Every input is validated with zod at the boundary.
 * Outputs never contain secrets: provider status exposes only a fingerprint.
 */
export function createApi(app: PixelApp, hooks: { pickFolder: () => Promise<string | null>; version: string; dataDir: string }) {
  const id = z.object({ id: z.string().min(1) });
  const h = <S extends z.ZodTypeAny, R>(schema: S, fn: (input: z.infer<S>) => Promise<R> | R) => ({ schema, fn });

  return {
    // ── app ──
    'app.info': h(z.void(), async () => ({
      version: hooks.version,
      dataDir: hooks.dataDir,
      credentialBackend: app.options.credentials.backend,
      platform: process.platform,
      arch: process.arch,
      onboarded: (await app.repos.settings.get<boolean>('onboarded')) ?? false,
    })),
    'app.createDemo': h(z.void(), () => app.createDemo()),
    'settings.set': h(z.object({ key: z.enum(['onboarded', 'theme']), value: z.unknown() }), (i) => app.repos.settings.set(i.key, i.value)),

    // ── providers & models ──
    'providers.kinds': h(z.void(), () => app.providers.kinds()),
    'providers.list': h(z.void(), () => app.providers.list()),
    'providers.add': h(
      z.object({ kind: z.enum(['anthropic', 'openai', 'gemini', 'openrouter', 'openai_compatible', 'local']), name: z.string().max(80), baseUrl: z.string().max(500).nullable().optional(), secret: z.string().max(4096).optional() }),
      async (i) => {
        const cfg = await app.providers.add(i);
        return { id: cfg.id };
      },
    ),
    'providers.remove': h(id, (i) => app.providers.remove(i.id)),
    'providers.setEnabled': h(z.object({ id: z.string(), enabled: z.boolean() }), (i) => app.providers.setEnabled(i.id, i.enabled)),
    'providers.setSecret': h(z.object({ id: z.string(), secret: z.string().min(1).max(4096) }), (i) => app.providers.setSecret(i.id, i.secret)),
    'providers.clearSecret': h(id, (i) => app.providers.clearSecret(i.id)),
    'providers.test': h(id, (i) => app.providers.test(i.id)),
    'providers.discover': h(id, async (i) => (await app.providers.discover(i.id)).length),
    'models.list': h(z.object({ providerId: z.string().optional() }).optional(), (i) => app.providers.models(i?.providerId)),
    'models.setPricing': h(
      z.object({ ref: ModelRefSchema, pricing: z.object({ inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0), cachedInputPerMTok: z.number().min(0).optional() }).nullable() }),
      (i) => app.providers.setUserPricing(i.ref, i.pricing),
    ),

    // ── roles & agents ──
    'roles.list': h(z.void(), () => app.roles.list()),
    'roles.fork': h(z.object({ fromId: z.string(), name: z.string().max(80) }), (i) => app.roles.fork(i.fromId, i.name)),
    'roles.update': h(z.object({ id: z.string(), name: z.string().max(80).optional(), description: z.string().max(2000).optional(), constitution: ConstitutionSchema.optional() }), (i) => app.roles.update(i.id, i)),
    'roles.delete': h(id, (i) => app.roles.delete(i.id)),
    'agents.list': h(z.void(), () => app.agents.list()),
    'agents.save': h(z.object({ id: z.string().nullable(), spec: AgentSpecSchema }), (i) => app.agents.save(i.id, i.spec)),
    'agents.delete': h(id, (i) => app.agents.delete(i.id)),
    'tools.list': h(z.void(), () => app.tools.list().map((t) => ({ name: t.name, description: t.description, actionKind: t.actionKind }))),

    // ── tables ──
    'tables.list': h(z.void(), () => app.tables.list()),
    'tables.get': h(id, (i) => app.tables.get(i.id)),
    'tables.templates': h(z.void(), () => app.tables.templates()),
    'tables.create': h(z.object({ name: z.string().max(80), projectId: z.string().nullable().optional(), templateId: z.string().optional() }), (i) => app.tables.create(i)),
    'tables.update': h(z.object({ id: z.string(), table: TableUpdateSchema }), (i) => app.tables.update(i.id, i.table)),
    'tables.delete': h(id, (i) => app.tables.delete(i.id)),
    'tables.validate': h(id, (i) => app.tables.validate(i.id)),

    // ── projects ──
    'projects.list': h(z.void(), () => app.projects.list()),
    'projects.create': h(ProjectInputSchema, (i) => app.projects.create(i)),
    'projects.update': h(z.object({ id: z.string(), name: z.string().max(80).optional(), description: z.string().max(2000).optional(), budgetUsd: z.number().min(0).max(10_000).optional() }), ({ id: pid, ...patch }) => app.projects.update(pid, patch)),
    'projects.delete': h(id, (i) => app.projects.delete(i.id)),
    'projects.pickFolder': h(z.void(), () => hooks.pickFolder()),
    'projects.gitStatus': h(id, (i) => app.projects.gitStatus(i.id)),
    'projects.getCeiling': h(id, (i) => app.projects.getCeiling(i.id)),
    'projects.setCeiling': h(z.object({ id: z.string(), grant: PermissionGrantSchema }), (i) => app.projects.setCeiling(i.id, i.grant)),

    // ── runs ──
    'runs.list': h(z.object({ projectId: z.string().optional(), limit: z.number().int().min(1).max(500).optional() }).optional(), (i) => app.repos.runs.list(i ?? {})),
    'runs.detail': h(id, (i) => app.runs.detail(i.id)),
    'runs.startTable': h(z.object({ tableId: z.string(), task: z.string().min(1).max(20_000), projectId: z.string().nullable().optional() }), (i) => app.runs.startTableRun(i)),
    'runs.startAgent': h(z.object({ spec: AgentSpecSchema, task: z.string().min(1).max(20_000), projectId: z.string().nullable().optional() }), (i) => app.runs.startAgentRun(i)),
    'runs.startCompare': h(
      z.object({ task: z.string().min(1).max(20_000), roleId: z.string(), candidates: z.array(ModelRefSchema).min(2).max(8), reviewer: ModelRefSchema.nullable(), projectId: z.string().nullable().optional() }),
      (i) => app.runs.startCompareRun(i),
    ),
    'runs.cancel': h(id, (i) => app.runs.cancel(i.id)),
    'runs.rerun': h(z.object({ id: z.string(), task: z.string().min(1).max(20_000).optional(), seatModels: z.record(z.string(), ModelRefSchema).optional() }), (i) => app.runs.rerun(i.id, i)),

    // ── approvals ──
    'approvals.pending': h(z.void(), () => app.approvals.pending()),
    'approvals.resolve': h(z.object({ id: z.string(), decision: z.enum(['approved', 'denied']), note: z.string().max(2000).optional() }), (i) => app.approvals.resolve(i.id, i.decision, i.note)),

    // ── usage ──
    'usage.summary': h(z.object({ runId: z.string().optional(), since: z.number().optional() }).optional(), (i) => app.usage.summary(i ?? {})),

    // ── governance ──
    'policies.list': h(z.void(), () => app.repos.policies.list()),
    'policies.save': h(
      z.object({ id: z.string().nullable(), name: z.string().min(1).max(80), layer: LayerSchema.exclude(['safety', 'system']), scopeType: z.enum(['global', 'project', 'table']), scopeId: z.string().nullable(), rules: z.array(RuleSchema) }),
      async (i) => {
        const existing = i.id ? (await app.repos.policies.list()).find((p) => p.id === i.id) : null;
        if (existing?.locked) throw new Error('Locked policies cannot be edited');
        const pid = i.id ?? `policy_${Date.now().toString(36)}`;
        await app.repos.policies.upsert({ ...i, id: pid, locked: false }, Date.now());
        return pid;
      },
    ),
    'policies.delete': h(id, async (i) => {
      const p = (await app.repos.policies.list()).find((x) => x.id === i.id);
      if (p?.locked) throw new Error('Locked policies cannot be deleted');
      await app.repos.policies.delete(i.id);
    }),

    // ── MCP ──
    'mcp.list': h(z.void(), () => app.mcp.list()),
    'mcp.add': h(McpServerInputSchema, (i) => app.mcp.add(i)),
    'mcp.remove': h(id, (i) => app.mcp.remove(i.id)),
    'mcp.setSecret': h(z.object({ id: z.string(), key: z.string(), value: z.string().min(1).max(4096) }), (i) => app.mcp.setSecret(i.id, i.key, i.value)),
    'mcp.connect': h(id, (i) => app.mcp.connect(i.id)),
    'mcp.disconnect': h(id, (i) => app.mcp.disconnect(i.id)),

    // ── workflows ──
    'workflows.list': h(z.void(), () => app.workflows.list()),
    'workflows.get': h(id, (i) => app.workflows.get(i.id)),
    'workflows.create': h(z.object({ name: z.string().max(80), projectId: z.string().nullable().optional() }), (i) => app.workflows.create(i.name, i.projectId ?? null)),
    'workflows.save': h(
      z.object({ id: z.string(), workflow: z.object({ name: z.string().min(1).max(80), description: z.string().max(2000), projectId: z.string().nullable(), nodes: z.array(WorkflowNodeSchema), edges: z.array(WorkflowEdgeSchema) }) }),
      (i) => app.workflows.save(i.id, i.workflow),
    ),
    'workflows.delete': h(id, (i) => app.workflows.delete(i.id)),
    'workflows.start': h(z.object({ id: z.string(), task: z.string().min(1).max(20_000), projectId: z.string().nullable().optional() }), (i) => app.workflows.start(i.id, i.task, i.projectId ?? null)),
  };
}

type ApiDef = ReturnType<typeof createApi>;
export type ApiChannel = keyof ApiDef;
export type ApiInput<K extends ApiChannel> = z.input<ApiDef[K]['schema']>;
export type ApiOutput<K extends ApiChannel> = Awaited<ReturnType<ApiDef[K]['fn']>>;

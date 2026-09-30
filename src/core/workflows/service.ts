import { buildContext, constitutionHash } from '../agents/context';
import { AgentRunner, RunLedger } from '../agents/runner';
import { AgentSpecSchema, type AgentSpec } from '../agents/types';
import type { Adjudication, Proposal } from '../evaluation/contracts';
import type { EventBus, RunEvent } from '../events/types';
import type { ApprovalService } from '../governance/approval-service';
import type { ApprovalGate } from '../governance/approvals';
import { GovernanceEngine } from '../governance/engine';
import type { ProviderManager } from '../providers/manager';
import type { Role } from '../roles/types';
import type { RunJournal } from '../runs/journal';
import type { RunService } from '../runs/service';
import type { RunRecord } from '../runs/types';
import { DEFAULT_GRANT, intersectGrants, PermissionGrantSchema } from '../security/permissions';
import type { SecretRedactor } from '../security/redaction';
import type { ProjectsRepo, RolesRepo, TablesRepo } from '../storage/repos/definitions';
import type { RunsRepo } from '../storage/repos/runs';
import type { WorkflowsRepo } from '../storage/repos/workflows';
import { TableExecutor } from '../teams/executor';
import { ToolExecutor } from '../tools/executor';
import type { ToolRegistry } from '../tools/types';
import type { Clock, IdGenerator } from '../util/runtime';
import { cleanText, sleep } from '../util/runtime';
import { evaluateCondition, executeWorkflow, validateWorkflow, type NodeExecutor } from './engine';
import { WorkflowEdgeSchema, WorkflowNodeSchema, type Workflow, type WorkflowNode } from './types';
import { z } from 'zod';

export interface WorkflowServiceDeps {
  repo: WorkflowsRepo;
  runs: RunService;
  runsRepo: RunsRepo;
  approvals: ApprovalService;
  providers: ProviderManager;
  roles: RolesRepo;
  tables: TablesRepo;
  projects: ProjectsRepo;
  redactor: SecretRedactor;
  bus: EventBus<RunEvent>;
  runStatus: EventBus<RunRecord>;
  clock: Clock;
  ids: IdGenerator;
  tools?: ToolRegistry;
}

const SaveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).default(''),
  projectId: z.string().nullable().default(null),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
});

/** Default starter workflow: plan with a table, gate on the outcome, get human approval. */
function starter(): Pick<Workflow, 'nodes' | 'edges'> {
  return {
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: {}, x: 40, y: 160 },
      { id: 'council', type: 'table', label: 'Design Council', config: { tableId: null }, x: 240, y: 160 },
      { id: 'gate', type: 'condition', label: 'Approved?', config: { path: 'council.outcome', op: 'eq', value: 'approved' }, x: 460, y: 160 },
      { id: 'approve', type: 'approval', label: 'Human sign-off', config: { title: 'Ship the council’s plan?' }, x: 680, y: 80 },
      { id: 'done', type: 'end', label: 'Done', config: {}, x: 900, y: 80 },
      { id: 'stopped', type: 'end', label: 'Stopped', config: {}, x: 680, y: 260 },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'council', branch: null },
      { id: 'e2', source: 'council', target: 'gate', branch: null },
      { id: 'e3', source: 'gate', target: 'approve', branch: 'true' },
      { id: 'e4', source: 'approve', target: 'done', branch: null },
      { id: 'e5', source: 'gate', target: 'stopped', branch: 'false' },
    ],
  };
}

export class WorkflowService {
  constructor(private readonly d: WorkflowServiceDeps) {}

  list() {
    return this.d.repo.list();
  }

  get(id: string) {
    return this.d.repo.get(id);
  }

  async create(name: string, projectId: string | null = null): Promise<Workflow> {
    const now = this.d.clock.now();
    const firstTable = (await this.d.tables.list())[0];
    const s = starter();
    const council = s.nodes.find((n) => n.id === 'council')!;
    council.config = { tableId: firstTable?.id ?? null };
    const wf: Workflow = { id: this.d.ids.next('wf'), name: name.trim() || 'Untitled workflow', description: '', projectId, ...s, createdAt: now, updatedAt: now };
    await this.d.repo.save(wf);
    return wf;
  }

  async save(id: string, raw: z.input<typeof SaveSchema>): Promise<{ workflow: Workflow; validation: ReturnType<typeof validateWorkflow> }> {
    const existing = await this.d.repo.get(id);
    if (!existing) throw new Error('Workflow not found');
    const input = SaveSchema.parse(raw);
    const wf: Workflow = { ...existing, ...input, updatedAt: this.d.clock.now() };
    await this.d.repo.save(wf);
    return { workflow: wf, validation: validateWorkflow(wf) };
  }

  delete(id: string) {
    return this.d.repo.delete(id);
  }

  validate(wf: Pick<Workflow, 'nodes' | 'edges'>) {
    return validateWorkflow(wf);
  }

  async start(workflowId: string, rawTask: string, projectId: string | null = null): Promise<RunRecord> {
    const task = cleanText(rawTask).trim();
    if (!task) throw new Error('Task is required');
    const wf = await this.d.repo.get(workflowId);
    if (!wf) throw new Error('Workflow not found');
    const v = validateWorkflow(wf);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const project = projectId ?? wf.projectId ? await this.d.projects.get((projectId ?? wf.projectId)!) : null;
    const policies = await this.d.runs.policiesFor(project, null, []);
    const run = await this.d.runs.createRun({
      kind: 'workflow',
      title: `${wf.name}: ${task.replace(/\s+/g, ' ').slice(0, 60)}`,
      task,
      projectId: project?.id ?? null,
      sessionId: null,
      tableId: null,
      parentRunId: null,
      workflowId: wf.id,
      snapshot: { version: 1, kind: 'workflow', workflow: wf, policies },
    });
    this.d.runs.launch(run.id, async (signal, journal, gate) => {
      journal.event('run.started', { task, workflowId: wf.id, workflowName: wf.name, nodes: wf.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label })), seats: [] });
      const executors = this.executors(wf, project, policies, journal, gate);
      const result = await executeWorkflow(wf, task, executors, signal, {
        onNode: (id, state, info) => {
          const node = wf.nodes.find((n) => n.id === id)!;
          const type = state === 'running' ? 'node.started' : state === 'completed' ? 'node.completed' : state === 'failed' ? 'node.failed' : state === 'skipped' ? 'node.skipped' : null;
          if (type) journal.event(type, { nodeId: id, nodeType: node.type, label: node.label, output: summariseOutput(info.output), error: info.error, attempt: info.attempt });
        },
      });
      const endOutputs = wf.nodes.filter((n) => n.type === 'end' && result.states[n.id] === 'completed').map((n) => n.label || n.id);
      journal.artifact({
        seatId: null,
        kind: 'report',
        title: `Workflow ${result.status}${endOutputs.length ? ` → ${endOutputs.join(', ')}` : ''}`,
        mimeType: 'application/json',
        content: JSON.stringify({ status: result.status, states: result.states, errors: result.errors, outputs: summariseOutput(result.outputs) }, null, 2),
      });
      if (result.status === 'failed') throw new Error(Object.values(result.errors)[0] ?? 'Workflow failed');
      return result.status === 'cancelled' ? 'cancelled' : endOutputs.length ? `completed:${endOutputs.join(',')}` : 'completed';
    });
    return run;
  }

  private executors(wf: Workflow, project: Awaited<ReturnType<ProjectsRepo['get']>>, policies: Awaited<ReturnType<RunService['policiesFor']>>, journal: RunJournal, gate: ApprovalGate): Partial<Record<WorkflowNode['type'], NodeExecutor>> {
    const governance = new GovernanceEngine(policies);
    const root = project?.path ?? null;
    const toolsRegistry = this.d.tools;
    const passThrough: NodeExecutor = async (ctx) => ({ ...ctx.inputs });
    const roleOf = async (id: string): Promise<Role> => {
      const r = await this.d.roles.get(id);
      if (!r) throw new Error(`Unknown role ${id}`);
      return r;
    };
    const describeInputs = (inputs: Record<string, unknown>) =>
      Object.entries(inputs).map(([id, out]) => ({ title: `${id} (upstream node)`, source: `workflow:node:${id}`, content: '```json\n' + JSON.stringify(summariseOutput(out), null, 2).slice(0, 12_000) + '\n```' }));

    const agentStep = async (node: WorkflowNode, ctx: Parameters<NodeExecutor>[0], contract: 'proposal' | 'review' | 'adjudication') => {
      const spec: AgentSpec = AgentSpecSchema.parse(node.config.spec);
      const role = await roleOf(spec.roleId);
      const ceiling = await this.d.runs.ceilingFor(project ?? null, false);
      const seat = { seatId: node.id, role, spec, grant: intersectGrants(spec.permissions, ceiling) };
      if (!toolsRegistry) throw new Error('Tool registry unavailable');
      const runner = new AgentRunner(this.d.providers, governance, new ToolExecutor(toolsRegistry, governance, gate, journal, root), journal, new RunLedger());
      const upstream = Object.keys(ctx.inputs).filter((k) => ctx.inputs[k] && typeof ctx.inputs[k] === 'object');
      const instructions =
        contract === 'review'
          ? `You are seat ${node.id}. Review exactly these targetSeatIds: ${upstream.join(', ') || 'none'}.`
          : contract === 'adjudication'
            ? `You are seat ${node.id}. Decide on the upstream work. selectedSeatId must be one of: ${upstream.join(', ') || 'none'} (or null).`
            : `You are seat ${node.id}. Complete the task using upstream results as input.`;
      const manifest = buildContext({ role, spec, seatId: node.id, task: ctx.task, phase: { name: node.label || node.type.toUpperCase(), instructions }, contract, governanceSummary: governance.summarize(), permissions: seat.grant, peerWork: describeInputs(ctx.inputs) });
      journal.event('run.status', { seat: { seatId: node.id, name: spec.name, role: role.name, roleId: role.id, providerId: spec.model.providerId, model: spec.model.modelId, constitutionHash: constitutionHash(role) } }, node.id);
      return runner.invoke({ seat, manifest, contract, phase: node.label || node.type, tableId: null, workflowId: wf.id, signal: ctx.signal });
    };

    const toolStep = (fixedTool?: (node: WorkflowNode) => string): NodeExecutor => async (ctx) => {
      if (!toolsRegistry) throw new Error('Tool registry unavailable');
      const toolName = fixedTool ? fixedTool(ctx.node) : String(ctx.node.config.tool ?? '');
      const operator = await roleOf('role_operator');
      const grant = PermissionGrantSchema.parse({ ...DEFAULT_GRANT, ...((ctx.node.config.permissions as object) ?? {}) });
      const ceiling = await this.d.runs.ceilingFor(project ?? null, false);
      const seat = {
        seatId: ctx.node.id,
        role: operator,
        spec: { ...AgentSpecSchema.parse({ name: ctx.node.label || toolName, roleId: operator.id, model: { providerId: 'workflow', modelId: 'none' }, permissions: grant }), allowedTools: [toolName] },
        grant: intersectGrants(grant, ceiling),
      };
      const executor = new ToolExecutor(toolsRegistry, governance, gate, journal, root);
      const out = await executor.execute({ id: `${ctx.node.id}_${ctx.attempt}`, name: toolName, arguments: (ctx.node.config.args as Record<string, unknown>) ?? {} }, seat, ctx.signal);
      if (out.isError) throw new Error(out.content);
      return { tool: toolName, output: out.content };
    };

    return {
      start: async (ctx) => ({ task: ctx.task }),
      end: passThrough,
      parallel: passThrough,
      sequential: passThrough,
      agent: async (ctx) => (await agentStep(ctx.node, ctx, 'proposal')).output as Proposal,
      review: async (ctx) => (await agentStep(ctx.node, ctx, 'review')).output,
      judge: async (ctx) => {
        const adj = (await agentStep(ctx.node, ctx, 'adjudication')).output as Adjudication;
        const verdict = governance.evaluate({
          kind: 'final_decision',
          summary: { judgeSeatId: ctx.node.id, judgeDecision: adj.decision, judgeConfidence: adj.confidence, judgeEvidenceCount: adj.evidence.length, selectedSeatId: adj.selectedSeatId, unresolved: [], approvalWeight: 1, authorProviderId: null, reviewerProviderIds: [], integrityOk: true, costUsd: 0, tokens: 0 },
        });
        journal.event('governance.decision', { subject: 'final_decision', verdict }, ctx.node.id);
        return { ...adj, governance: verdict.decision };
      },
      table: async (ctx) => {
        const tableId = String(ctx.node.config.tableId ?? '');
        const table = await this.d.tables.get(tableId);
        if (!table) throw new Error('TABLE node has no valid table selected');
        const roles = new Map((await this.d.roles.list()).map((r) => [r.id, r]));
        const exec = new TableExecutor({ resolver: this.d.providers, tools: toolsRegistry!, approvals: gate, journal });
        const upstream = Object.values(ctx.inputs).filter((v) => v && typeof v === 'object' && !('task' in (v as object)));
        const task = upstream.length ? `${ctx.task}\n\nUpstream context:\n${JSON.stringify(summariseOutput(upstream)).slice(0, 8000)}` : ctx.task;
        const r = await exec.run({ table, roles, task, policies, workspaceRoot: root, permissionCeiling: await this.d.runs.ceilingFor(project ?? null, false), signal: ctx.signal, workflowId: wf.id });
        if (r.outcome === 'failed') throw new Error(r.error ?? 'Table failed');
        return { outcome: r.outcome, decision: r.verdict?.decision ?? null, finalAnswer: r.adjudication?.finalAnswer ?? null, selectedSeatId: r.adjudication?.selectedSeatId ?? null };
      },
      condition: async (ctx) => ({ result: evaluateCondition(ctx.node.config, ctx.outputs) }),
      approval: async (ctx) => {
        const request = { runId: journal.runId, seatId: ctx.node.id, kind: 'final_decision' as const, title: String(ctx.node.config.title ?? ctx.node.label ?? 'Approve workflow step?'), reason: 'Workflow approval node', detail: { nodeId: ctx.node.id, upstream: summariseOutput(ctx.inputs) } };
        journal.event('approval.requested', { request }, ctx.node.id);
        const res = await gate.request(request, ctx.signal);
        journal.event('approval.resolved', { kind: 'workflow', resolution: res }, ctx.node.id);
        if (res.decision !== 'approved') throw new Error(`Denied by ${res.by}`);
        return { approved: true, by: res.by };
      },
      tool: toolStep(),
      git: toolStep((n) => (n.config.operation === 'diff' ? 'git_diff' : 'git_status')),
      browser: toolStep((n) => String(n.config.tool ?? 'browser_navigate')),
      mac: toolStep((n) => String(n.config.tool ?? 'mac_screenshot')),
      wait: async (ctx) => {
        const ms = Math.min(Math.max(0, Number(ctx.node.config.ms ?? 1000)), 10 * 60_000);
        await sleep(ms, ctx.signal);
        return { waitedMs: ms };
      },
      loop: async (ctx) => {
        const body = String(ctx.node.config.bodyNodeId ?? Object.keys(ctx.inputs)[0] ?? '');
        const max = Math.min(Math.max(1, Number(ctx.node.config.maxIterations ?? 2)), 5);
        let last = ctx.inputs[body];
        let iterations = 0;
        while (iterations < max && !evaluateCondition({ ...ctx.node.config, path: String(ctx.node.config.path ?? `${body}.outcome`) }, { ...ctx.outputs, [body]: last })) {
          iterations++;
          last = await ctx.rerun(body, `Previous attempt (iteration ${iterations}) did not satisfy the loop condition. Previous result:\n${JSON.stringify(summariseOutput(last)).slice(0, 4000)}`);
          ctx.outputs[body] = last;
        }
        return { iterations, satisfied: evaluateCondition({ ...ctx.node.config, path: String(ctx.node.config.path ?? `${body}.outcome`) }, { ...ctx.outputs, [body]: last }), last: summariseOutput(last) };
      },
    };
  }
}

function summariseOutput(v: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => summariseOutput(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, summariseOutput(x, depth + 1)]));
  return v;
}

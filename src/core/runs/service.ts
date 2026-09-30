import { join } from 'node:path';
import { buildContext, constitutionHash } from '../agents/context';
import { AgentRunner, RunLedger } from '../agents/runner';
import type { AgentSpec } from '../agents/types';
import type { Proposal, ReviewOutput } from '../evaluation/contracts';
import type { EventBus, RunEvent } from '../events/types';
import type { GitService } from '../git/service';
import type { ApprovalService } from '../governance/approval-service';
import type { ApprovalGate } from '../governance/approvals';
import { projectPolicy, SAFETY_POLICY, SYSTEM_POLICY } from '../governance/defaults';
import { GovernanceEngine } from '../governance/engine';
import type { Policy, Rule } from '../governance/types';
import type { Project } from '../projects/types';
import type { ProviderManager } from '../providers/manager';
import type { ModelRef } from '../providers/types';
import type { Role } from '../roles/types';
import { DEFAULT_GRANT, intersectGrants, type PermissionGrant } from '../security/permissions';
import type { SecretRedactor } from '../security/redaction';
import type { PermissionsRepo, PoliciesRepo, ProjectsRepo, RolesRepo, TablesRepo } from '../storage/repos/definitions';
import type { RunsRepo } from '../storage/repos/runs';
import { TableExecutor, mapLimit } from '../teams/executor';
import type { Table } from '../teams/types';
import { effectiveAuthority, validateTable } from '../teams/validate';
import { ToolExecutor } from '../tools/executor';
import type { ToolRegistry } from '../tools/types';
import type { Clock, IdGenerator } from '../util/runtime';
import { RunJournal } from './journal';
import type { RunRecord, RunStatus } from './types';

export interface RunServiceDeps {
  runs: RunsRepo;
  tables: TablesRepo;
  roles: RolesRepo;
  projects: ProjectsRepo;
  policies: PoliciesRepo;
  permissions: PermissionsRepo;
  providers: ProviderManager;
  approvals: ApprovalService;
  tools: ToolRegistry;
  git: GitService;
  redactor: SecretRedactor;
  bus: EventBus<RunEvent>;
  runStatus: EventBus<RunRecord>;
  clock: Clock;
  ids: IdGenerator;
  worktreesDir: string;
}

/** Default workspace ceiling for a project: agents work in isolated worktrees, never on the user's checkout. */
export const PROJECT_DEFAULT_CEILING: PermissionGrant = {
  filesystem: 'worktree_write',
  terminal: 'approval',
  git: 'worktree',
  browser: 'approval',
  network: 'denied',
  system: 'denied',
  mcp: 'approval',
};

export interface TableRunSnapshot {
  version: 1;
  kind: 'table';
  table: Table;
  roles: Role[];
  policies: Policy[];
  ceiling: PermissionGrant;
  constitutionHashes: Record<string, string>;
}

export interface StartTableRunInput {
  tableId: string;
  task: string;
  projectId?: string | null;
  sessionId?: string | null;
  taskRules?: Rule[];
}

export interface CompareCandidate {
  model: ModelRef;
}

/**
 * Orchestrates runs: snapshotting, workspace isolation, background execution, status, cancellation,
 * replay/branching. Business logic lives here and below — never in the UI.
 */
export class RunService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly d: RunServiceDeps) {}

  /** Mark runs left mid-flight by a previous process. */
  async recoverInterrupted(): Promise<number> {
    const stale = await this.d.runs.listByStatus(['queued', 'running', 'awaiting_approval']);
    for (const r of stale) {
      await this.d.runs.update(r.id, { status: 'failed', error: 'Interrupted: PIXEL was closed while this run was active. Replay it to run again.', finishedAt: this.d.clock.now() });
    }
    return stale.length;
  }

  async startTableRun(input: StartTableRunInput, parentRunId: string | null = null, snapshotOverride?: TableRunSnapshot): Promise<RunRecord> {
    const task = input.task.trim();
    if (!task) throw new Error('Task is required');
    const project = input.projectId ? await this.d.projects.get(input.projectId) : null;
    const snapshot = snapshotOverride ?? (await this.snapshotTable(input.tableId, project, input.taskRules ?? []));
    const validation = validateTable(snapshot.table, new Map(snapshot.roles.map((r) => [r.id, r])));
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    await this.assertModelsAvailable(snapshot.table.seats.map((s) => s.spec.model));

    const run = await this.createRun({
      kind: 'table',
      title: `${snapshot.table.name}: ${summarise(task)}`,
      task,
      projectId: project?.id ?? null,
      sessionId: input.sessionId ?? null,
      tableId: snapshot.table.id,
      parentRunId,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
    this.launch(run.id, (signal, journal, gate) => this.executeTable(run, snapshot, project, signal, journal, gate));
    return run;
  }

  /** Replay a run exactly (same snapshot), or branch it with a new task and/or different models per seat. */
  async rerun(runId: string, overrides: { task?: string; seatModels?: Record<string, ModelRef> } = {}): Promise<RunRecord> {
    const parent = await this.d.runs.get(runId);
    if (!parent) throw new Error('Run not found');
    if (parent.kind !== 'table') throw new Error('Only table runs can be replayed');
    const snapshot = structuredClone(parent.snapshot) as unknown as TableRunSnapshot;
    for (const seat of snapshot.table.seats) {
      const m = overrides.seatModels?.[seat.id];
      if (m) seat.spec.model = m;
    }
    return this.startTableRun({ tableId: snapshot.table.id, task: overrides.task ?? parent.task, projectId: parent.projectId, sessionId: parent.sessionId }, parent.id, snapshot);
  }

  /** Single agent, governed (Playground). */
  async startAgentRun(input: { spec: AgentSpec; task: string; projectId?: string | null }): Promise<RunRecord> {
    const role = await this.d.roles.get(input.spec.roleId);
    if (!role) throw new Error('Unknown role');
    await this.assertModelsAvailable([input.spec.model]);
    const project = input.projectId ? await this.d.projects.get(input.projectId) : null;
    const policies = await this.policiesFor(project, null, []);
    const run = await this.createRun({
      kind: 'agent',
      title: `${input.spec.name}: ${summarise(input.task)}`,
      task: input.task,
      projectId: project?.id ?? null,
      sessionId: null,
      tableId: null,
      parentRunId: null,
      snapshot: { version: 1, kind: 'agent', spec: input.spec, role, policies },
    });
    this.launch(run.id, async (signal, journal, gate) => {
      const governance = new GovernanceEngine(policies);
      const root = project?.path ?? null;
      const ceiling = await this.ceilingFor(project, false);
      const seat = { seatId: 'agent', role, spec: input.spec, grant: intersectGrants(input.spec.permissions, ceiling) };
      const tools = new ToolExecutor(this.d.tools, governance, gate, journal, root);
      const runner = new AgentRunner(this.d.providers, governance, tools, journal, new RunLedger());
      journal.event('run.started', { task: input.task, seats: [{ seatId: 'agent', name: input.spec.name, role: role.name, roleId: role.id, providerId: input.spec.model.providerId, model: input.spec.model.modelId, authority: role.constitution.authority, constitutionHash: constitutionHash(role) }] });
      const manifest = buildContext({ role, spec: input.spec, seatId: 'agent', task: input.task, phase: { name: 'RESPOND', instructions: 'You are seat agent. Complete the task.' }, contract: 'proposal', governanceSummary: governance.summarize(), permissions: seat.grant });
      const r = await runner.invoke<'proposal'>({ seat, manifest, contract: 'proposal', phase: 'RESPOND', tableId: null, workflowId: null, signal });
      journal.artifact({ seatId: 'agent', kind: 'final_result', title: r.output.summary.slice(0, 100), mimeType: 'text/markdown', content: renderProposal(r.output) });
      return 'completed';
    });
    return run;
  }

  /**
   * Model Observatory: the same task, same role, several models. Each candidate works independently;
   * an optional reviewer model (on the Critic constitution) reviews every candidate blind.
   */
  async startCompareRun(input: { task: string; roleId: string; candidates: ModelRef[]; reviewer: ModelRef | null; projectId?: string | null }): Promise<RunRecord> {
    const role = await this.d.roles.get(input.roleId);
    const critic = await this.d.roles.get('role_critic');
    if (!role || !critic) throw new Error('Unknown role');
    if (input.candidates.length < 2) throw new Error('Pick at least two models to compare');
    await this.assertModelsAvailable([...input.candidates, ...(input.reviewer ? [input.reviewer] : [])]);
    const project = input.projectId ? await this.d.projects.get(input.projectId) : null;
    const policies = await this.policiesFor(project, null, []);
    const run = await this.createRun({
      kind: 'compare',
      title: `Compare ${input.candidates.length} models: ${summarise(input.task)}`,
      task: input.task,
      projectId: project?.id ?? null,
      sessionId: null,
      tableId: null,
      parentRunId: null,
      snapshot: { version: 1, kind: 'compare', role, candidates: input.candidates, reviewer: input.reviewer, policies },
    });
    this.launch(run.id, async (signal, journal, gate) => {
      const governance = new GovernanceEngine(policies);
      const tools = new ToolExecutor(this.d.tools, governance, gate, journal, null);
      const runner = new AgentRunner(this.d.providers, governance, tools, journal, new RunLedger());
      const seats = input.candidates.map((model, i) => ({
        seatId: `candidate_${i + 1}`,
        role,
        spec: { name: `${model.modelId}`, roleId: role.id, objective: '', model, systemRules: [], allowedTools: [], permissions: { ...DEFAULT_GRANT }, memoryPolicy: 'none' as const, maxOutputTokens: 4096 },
        grant: { ...DEFAULT_GRANT },
      }));
      journal.event('run.started', { task: input.task, seats: seats.map((s) => ({ seatId: s.seatId, name: s.spec.name, role: role.name, roleId: role.id, providerId: s.spec.model.providerId, model: s.spec.model.modelId, authority: role.constitution.authority, constitutionHash: constitutionHash(role) })) });
      journal.event('phase.started', { phase: 'propose', seats: seats.map((s) => s.seatId) });
      const results = await mapLimit(seats, 4, async (seat) => {
        const manifest = buildContext({ role, spec: seat.spec, seatId: seat.seatId, task: input.task, phase: { name: 'PROPOSE', instructions: `You are seat ${seat.seatId}. Work independently.` }, contract: 'proposal', governanceSummary: governance.summarize(), permissions: seat.grant });
        try {
          const r = await runner.invoke<'proposal'>({ seat, manifest, contract: 'proposal', phase: 'PROPOSE', tableId: null, workflowId: null, signal });
          return { seat, r, error: null as string | null };
        } catch (err) {
          journal.event('agent.error', { phase: 'propose', message: (err as Error).message }, seat.seatId);
          return { seat, r: null, error: (err as Error).message };
        }
      });
      journal.event('phase.completed', { phase: 'propose' });

      let review: ReviewOutput | null = null;
      if (input.reviewer && results.some((x) => x.r)) {
        const reviewer = { seatId: 'reviewer', role: critic, spec: { name: `Reviewer (${input.reviewer.modelId})`, roleId: critic.id, objective: '', model: input.reviewer, systemRules: [], allowedTools: [], permissions: { ...DEFAULT_GRANT }, memoryPolicy: 'none' as const, maxOutputTokens: 4096 }, grant: { ...DEFAULT_GRANT } };
        const done = results.filter((x) => x.r);
        journal.event('phase.started', { phase: 'review', seats: ['reviewer'] });
        const manifest = buildContext({
          role: critic,
          spec: reviewer.spec,
          seatId: 'reviewer',
          task: input.task,
          phase: { name: 'REVIEW', instructions: `You are seat reviewer. Review exactly these targetSeatIds: ${done.map((x) => x.seat.seatId).join(', ')}. Candidate model identities are hidden from you.` },
          contract: 'review',
          governanceSummary: governance.summarize(),
          permissions: reviewer.grant,
          peerWork: done.map((x) => ({ title: `${x.seat.seatId} (candidate)`, source: `run:proposal:${x.seat.seatId}`, content: '```json\n' + JSON.stringify({ seatId: x.seat.seatId, ...x.r!.output }, null, 2) + '\n```' })),
        });
        try {
          review = (await runner.invoke<'review'>({ seat: reviewer, manifest, contract: 'review', phase: 'REVIEW', tableId: null, workflowId: null, signal })).output;
        } catch (err) {
          journal.event('agent.error', { phase: 'review', message: (err as Error).message }, 'reviewer');
        }
        journal.event('phase.completed', { phase: 'review' });
      }

      const report = results.map((x) => {
        const rv = review?.reviews.find((r) => r.targetSeatId === x.seat.seatId);
        return {
          seatId: x.seat.seatId,
          model: x.seat.spec.model,
          error: x.error,
          summary: x.r?.output.summary ?? null,
          selfConfidence: x.r?.output.confidence ?? null,
          evidenceItems: x.r?.output.evidence.length ?? 0,
          tokens: x.r?.tokens ?? 0,
          latencyMs: x.r?.latencyMs ?? 0,
          costUsd: x.r?.costUsd ?? null,
          toolCalls: x.r?.toolCalls ?? 0,
          attempts: x.r?.attempts ?? 0,
          review: rv ? { verdict: rv.verdict, confidence: rv.confidence, challenges: rv.challenges.map((c) => ({ severity: c.severity, claim: c.claim })), summary: rv.summary } : null,
        };
      });
      for (const x of results) if (x.r) journal.artifact({ seatId: x.seat.seatId, kind: 'proposal', title: `${x.seat.spec.model.modelId}: ${x.r.output.summary.slice(0, 80)}`, mimeType: 'application/json', content: JSON.stringify(x.r.output, null, 2) });
      journal.artifact({ seatId: null, kind: 'report', title: 'Model comparison', mimeType: 'application/json', content: JSON.stringify(report, null, 2) });
      return 'completed';
    });
    return run;
  }

  async cancel(runId: string): Promise<void> {
    this.controllers.get(runId)?.abort();
  }

  /** Await completion of a background run (tests and headless use). */
  async wait(runId: string): Promise<RunRecord | null> {
    await this.inflight.get(runId);
    return this.d.runs.get(runId);
  }

  async detail(runId: string) {
    const run = await this.d.runs.get(runId);
    if (!run) return null;
    const [events, judgments, usage, toolCalls, artifacts, approvals, seats] = await Promise.all([
      this.d.runs.events(runId),
      this.d.runs.judgments(runId),
      this.d.runs.usage({ runId }),
      this.d.runs.toolCalls(runId),
      this.d.runs.artifacts(runId),
      this.d.runs.approvals({ runId }),
      this.d.runs.seats(runId),
    ]);
    return { run, events, judgments, usage, toolCalls, artifacts, approvals, seats };
  }

  // ── internals ──

  private async snapshotTable(tableId: string, project: Project | null, taskRules: Rule[]): Promise<TableRunSnapshot> {
    const table = await this.d.tables.get(tableId);
    if (!table) throw new Error('Table not found');
    const roleIds = [...new Set(table.seats.map((s) => s.spec.roleId))];
    const roles = (await Promise.all(roleIds.map((id) => this.d.roles.get(id)))).filter((r): r is Role => !!r);
    const policies = await this.policiesFor(project, table.id, taskRules);
    const ceiling = await this.ceilingFor(project, true);
    return { version: 1, kind: 'table', table, roles, policies, ceiling, constitutionHashes: Object.fromEntries(roles.map((r) => [r.id, constitutionHash(r)])) };
  }

  /**
   * Effective policies. Safety and System always come from code — never from the database — so
   * neither agents nor a tampered DB can weaken them.
   */
  async policiesFor(project: Project | null, tableId: string | null, taskRules: Rule[]): Promise<Policy[]> {
    const stored = (await this.d.policies.list()).filter(
      (p) => !p.locked && p.layer !== 'safety' && p.layer !== 'system' && (p.scopeType === 'global' || (p.scopeType === 'project' && p.scopeId === project?.id) || (p.scopeType === 'table' && p.scopeId === tableId)),
    );
    return [
      SAFETY_POLICY,
      SYSTEM_POLICY,
      ...(project ? [projectPolicy(project.id, { maxCostUsd: project.budgetUsd })] : []),
      ...stored.map(({ scopeType: _s, scopeId: _i, ...p }) => p),
      ...(taskRules.length ? [{ id: 'policy_task', name: 'Task', layer: 'task' as const, locked: false, rules: taskRules }] : []),
    ];
  }

  async ceilingFor(project: Project | null, isolated: boolean): Promise<PermissionGrant> {
    if (!project) return { ...DEFAULT_GRANT, filesystem: 'none', git: 'none' };
    const stored = (await this.d.permissions.get('project', project.id)) ?? PROJECT_DEFAULT_CEILING;
    // Without an isolated worktree, agents may not write to the user's files unless explicitly allowed.
    if (!(isolated && project.isGit) && stored.filesystem === 'worktree_write') return { ...stored, filesystem: 'project_read', git: stored.git === 'none' ? 'none' : 'read' };
    return stored;
  }

  async assertModelsAvailable(refs: ModelRef[]) {
    for (const ref of refs) {
      const info = await this.d.providers.modelInfo(ref);
      if (!info) throw new Error(`Model ${ref.modelId} is not available on provider ${ref.providerId}. Discover models first.`);
    }
  }

  async createRun(r: Pick<RunRecord, 'kind' | 'title' | 'task' | 'projectId' | 'sessionId' | 'tableId' | 'parentRunId' | 'snapshot'> & { workflowId?: string | null }): Promise<RunRecord> {
    const run: RunRecord = { id: this.d.ids.next('run'), workflowId: null, status: 'queued', outcome: null, workspacePath: null, branch: null, error: null, createdAt: this.d.clock.now(), startedAt: null, finishedAt: null, ...r };
    await this.d.runs.create(run);
    this.d.runStatus.publish(run);
    return run;
  }

  private async setStatus(runId: string, patch: Parameters<RunsRepo['update']>[1]) {
    await this.d.runs.update(runId, patch);
    const run = await this.d.runs.get(runId);
    if (run) this.d.runStatus.publish(run);
  }

  launch(runId: string, body: (signal: AbortSignal, journal: RunJournal, gate: ApprovalGate) => Promise<string>) {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const journal = new RunJournal(runId, { store: this.d.runs, redactor: this.d.redactor, bus: this.d.bus, clock: this.d.clock, ids: this.d.ids });
    // Gate wrapper surfaces "awaiting approval" as a run status.
    const gate: ApprovalGate = {
      request: async (req, signal) => {
        await this.setStatus(runId, { status: 'awaiting_approval' });
        try {
          return await this.d.approvals.request(req, signal);
        } finally {
          if (!controller.signal.aborted) await this.setStatus(runId, { status: 'running' });
        }
      },
    };
    const job = (async () => {
      await this.setStatus(runId, { status: 'running', startedAt: this.d.clock.now() });
      let status: RunStatus = 'completed';
      let outcome: string | null = null;
      let error: string | null = null;
      try {
        outcome = await body(controller.signal, journal, gate);
        if (outcome === 'cancelled') status = 'cancelled';
        if (outcome === 'failed') status = 'failed';
      } catch (err) {
        const aborted = controller.signal.aborted;
        status = aborted ? 'cancelled' : 'failed';
        outcome = aborted ? 'cancelled' : 'failed';
        error = aborted ? null : this.d.redactor.redactString((err as Error).message);
        journal.event(aborted ? 'run.cancelled' : 'run.failed', { error });
      }
      if (status === 'completed') journal.event('run.completed', { outcome });
      try {
        await journal.flush();
      } catch (err) {
        status = 'failed';
        error = `Persistence failure: ${(err as Error).message}`;
      }
      await this.setStatus(runId, { status, outcome, error, finishedAt: this.d.clock.now() });
      this.controllers.delete(runId);
    })();
    this.inflight.set(runId, job);
    void job.finally(() => this.inflight.delete(runId));
  }

  private async executeTable(run: RunRecord, snapshot: TableRunSnapshot, project: Project | null, signal: AbortSignal, journal: RunJournal, gate: ApprovalGate): Promise<string> {
    const roles = new Map(snapshot.roles.map((r) => [r.id, r]));
    // Tamper check: the constitutions about to run must be the ones snapshotted at launch.
    for (const [id, hash] of Object.entries(snapshot.constitutionHashes)) {
      const role = roles.get(id);
      if (!role || constitutionHash(role) !== hash) throw new Error(`Constitution snapshot mismatch for ${id}`);
    }
    await this.d.runs.addSeats(
      snapshot.table.seats.map((s) => {
        const role = roles.get(s.spec.roleId)!;
        return { runId: run.id, seatId: s.id, name: s.spec.name, roleId: role.id, providerId: s.spec.model.providerId, modelId: s.spec.model.modelId, constitutionHash: constitutionHash(role), authority: effectiveAuthority(role, s) };
      }),
    );

    const workspace = await this.prepareWorkspace(run, snapshot, project, journal);
    const exec = new TableExecutor({ resolver: this.d.providers, tools: this.d.tools, approvals: gate, journal });
    const result = await exec.run({ table: snapshot.table, roles, task: run.task, policies: snapshot.policies, workspaceRoot: workspace.root, permissionCeiling: snapshot.ceiling, signal });
    if (workspace.isolated && workspace.root) await this.captureWorkspace(workspace.root, journal);
    if (result.error && result.outcome === 'failed') throw new Error(result.error);
    return result.outcome;
  }

  private async prepareWorkspace(run: RunRecord, snapshot: TableRunSnapshot, project: Project | null, journal: RunJournal) {
    if (!project?.path) return { root: null, isolated: false };
    const writes = snapshot.table.seats.some((s) => {
      const g = intersectGrants(s.spec.permissions, snapshot.ceiling);
      return g.filesystem === 'worktree_write' || g.git === 'worktree' || g.terminal !== 'denied';
    });
    if (project.isGit && writes) {
      const path = join(this.d.worktreesDir, run.id);
      const branch = `pixel/${run.id}`;
      await this.d.git.createWorktree(project.path, path, branch);
      await this.d.runs.update(run.id, { workspacePath: path, branch });
      journal.event('run.status', { workspace: 'isolated_worktree', path, branch });
      return { root: path, isolated: true };
    }
    journal.event('run.status', { workspace: 'project_read_only', path: project.path });
    return { root: project.path, isolated: false };
  }

  private async captureWorkspace(root: string, journal: RunJournal) {
    try {
      const stat = await this.d.git.diffStat(root);
      if (stat.filesChanged === 0) return;
      const diff = await this.d.git.diff(root);
      const sha = await this.d.git.checkpoint(root, `PIXEL checkpoint for ${journal.runId}`);
      journal.artifact({ seatId: null, kind: 'diff', title: `${stat.filesChanged} files · +${stat.linesAdded} −${stat.linesRemoved}`, mimeType: 'text/x-diff', content: diff.slice(0, 500_000) });
      journal.event('run.status', { checkpoint: sha, diffStat: stat });
    } catch (err) {
      journal.event('agent.error', { phase: 'checkpoint', message: (err as Error).message });
    }
  }
}

function summarise(task: string) {
  const t = task.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

export function renderProposal(p: Proposal): string {
  return [
    `# ${p.summary}`,
    '',
    p.approach,
    ...(p.steps.length ? ['', '## Steps', ...p.steps.map((s, i) => `${i + 1}. ${s}`)] : []),
    ...(p.risks.length ? ['', '## Risks', ...p.risks.map((r) => `- ${r.risk}${r.mitigation ? ` — ${r.mitigation}` : ''}`)] : []),
    ...(p.evidence.length ? ['', '## Evidence', ...p.evidence.map((e) => `- ${e.source}: ${e.detail}`)] : []),
    '',
    `_Confidence ${p.confidence.toFixed(2)}_`,
  ].join('\n');
}

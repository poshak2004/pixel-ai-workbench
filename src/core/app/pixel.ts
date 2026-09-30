import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventBus, type RunEvent } from '../events/types';
import { GitService } from '../git/service';
import { ApprovalService } from '../governance/approval-service';
import { ProviderManager } from '../providers/manager';
import { ProviderRegistry } from '../providers/registry';
import type { FetchLike } from '../providers/types';
import type { RunRecord } from '../runs/types';
import { RunService } from '../runs/service';
import type { CredentialStore } from '../security/credentials';
import { SecretRedactor } from '../security/redaction';
import { openDatabase, type Database } from '../storage/db';
import { AgentsRepo, PermissionsRepo, PoliciesRepo, ProjectsRepo, RolesRepo, SessionsRepo, SettingsRepo, TablesRepo } from '../storage/repos/definitions';
import { ProvidersRepo } from '../storage/repos/providers';
import { RunsRepo } from '../storage/repos/runs';
import { listDirTool, readFileTool, writeFileTool } from '../tools/fs';
import { gitTools } from '../tools/git-tools';
import { shellExecTool } from '../tools/shell';
import { ToolRegistry } from '../tools/types';
import { UsageService } from '../usage/service';
import { systemClock, uuidIds, type Clock, type IdGenerator } from '../util/runtime';
import { browserTools, UnconfiguredBrowserDriver } from '../browser/tools';
import { computerTools, UnconfiguredComputerDriver } from '../computer/tools';
import { WorkflowService } from '../workflows/service';
import { WorkflowsRepo } from '../storage/repos/workflows';
import { seed, DEMO_PROVIDER_IDS } from './seed';
import { AgentService, ProjectService, RoleService, TableService } from './services';

export interface PixelAppOptions {
  dataDir: string;
  migrationsFolder: string;
  credentials: CredentialStore;
  fetch?: FetchLike;
  /** Simulated latency scale for offline demo providers (0 in tests). */
  latencyScale?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Composition root for PIXEL's local runtime. Electron-free: the main process, tests and any
 * future CLI all build the exact same object graph.
 */
export class PixelApp {
  readonly bus = new EventBus<RunEvent>();
  readonly runStatus = new EventBus<RunRecord>();
  readonly redactor = new SecretRedactor();
  readonly git = new GitService();
  readonly tools: ToolRegistry;

  readonly repos: {
    providers: ProvidersRepo;
    roles: RolesRepo;
    agents: AgentsRepo;
    tables: TablesRepo;
    projects: ProjectsRepo;
    sessions: SessionsRepo;
    policies: PoliciesRepo;
    permissions: PermissionsRepo;
    settings: SettingsRepo;
    runs: RunsRepo;
    workflows: WorkflowsRepo;
  };
  readonly providers: ProviderManager;
  readonly approvals: ApprovalService;
  readonly runs: RunService;
  readonly usage: UsageService;
  readonly projects: ProjectService;
  readonly tables: TableService;
  readonly agents: AgentService;
  readonly roles: RoleService;
  readonly workflows: WorkflowService;

  private constructor(
    private readonly database: Database,
    readonly options: PixelAppOptions,
  ) {
    const db = database.db;
    const clock = options.clock ?? systemClock;
    const ids = options.ids ?? uuidIds;
    this.repos = {
      providers: new ProvidersRepo(db),
      roles: new RolesRepo(db),
      agents: new AgentsRepo(db),
      tables: new TablesRepo(db),
      projects: new ProjectsRepo(db),
      sessions: new SessionsRepo(db),
      policies: new PoliciesRepo(db),
      permissions: new PermissionsRepo(db),
      settings: new SettingsRepo(db),
      runs: new RunsRepo(db),
      workflows: new WorkflowsRepo(db),
    };
    this.tools = new ToolRegistry()
      .register(listDirTool)
      .register(readFileTool)
      .register(writeFileTool)
      .register(shellExecTool);
    for (const t of [...gitTools(this.git), ...browserTools(new UnconfiguredBrowserDriver()), ...computerTools(new UnconfiguredComputerDriver())]) this.tools.register(t);

    this.providers = new ProviderManager(this.repos.providers, new ProviderRegistry(), options.credentials, this.redactor, { fetch: options.fetch ?? fetch, latencyScale: options.latencyScale }, clock, ids);
    this.approvals = new ApprovalService(this.repos.runs, clock, ids);
    this.runs = new RunService({
      runs: this.repos.runs,
      tables: this.repos.tables,
      roles: this.repos.roles,
      projects: this.repos.projects,
      policies: this.repos.policies,
      permissions: this.repos.permissions,
      providers: this.providers,
      approvals: this.approvals,
      tools: this.tools,
      git: this.git,
      redactor: this.redactor,
      bus: this.bus,
      runStatus: this.runStatus,
      clock,
      ids,
      worktreesDir: join(options.dataDir, 'worktrees'),
    });
    this.usage = new UsageService(this.repos.runs);
    this.projects = new ProjectService(this.repos.projects, this.repos.permissions, this.git, clock, ids);
    this.tables = new TableService(this.repos.tables, this.repos.roles, clock, ids);
    this.agents = new AgentService(this.repos.agents, this.repos.roles, clock, ids);
    this.roles = new RoleService(this.repos.roles, clock, ids);
    this.workflows = new WorkflowService({ repo: this.repos.workflows, runs: this.runs, runsRepo: this.repos.runs, approvals: this.approvals, providers: this.providers, roles: this.repos.roles, tables: this.repos.tables, projects: this.repos.projects, redactor: this.redactor, bus: this.bus, runStatus: this.runStatus, clock, ids, tools: this.tools });
  }

  static async open(options: PixelAppOptions): Promise<PixelApp> {
    await mkdir(options.dataDir, { recursive: true });
    const database = await openDatabase({ url: `file:${join(options.dataDir, 'pixel.db')}`, migrationsFolder: options.migrationsFolder });
    const app = new PixelApp(database, options);
    await seed({ roles: app.repos.roles, policies: app.repos.policies, providersRepo: app.repos.providers, providers: app.providers, settings: app.repos.settings, clock: options.clock ?? systemClock });
    await app.runs.recoverInterrupted();
    await app.approvals.expireOrphans();
    return app;
  }

  /**
   * Demo mode: a sample workspace (a git repo), a project and the Design Council table on three
   * offline providers. Works with no API keys and no network.
   */
  async createDemo(): Promise<{ projectId: string; tableId: string }> {
    const ws = join(this.options.dataDir, 'demo-workspace');
    await mkdir(join(ws, 'src', 'sync'), { recursive: true });
    await writeFile(join(ws, 'README.md'), '# Sync API\n\nA small service that syncs notes between devices.\nCurrently unauthenticated — anyone with the URL can read and write.\n');
    await writeFile(join(ws, 'package.json'), JSON.stringify({ name: 'sync-api', version: '0.3.0', private: true, scripts: { test: 'node --test' } }, null, 2) + '\n');
    await writeFile(join(ws, 'src', 'sync', 'server.ts'), "export function handle(req: { path: string; body?: string }) {\n  // TODO: authentication\n  return { status: 200, body: `synced ${req.path}` };\n}\n");
    try {
      if (!(await this.git.isRepo(ws))) {
        await this.git.init(ws);
        await this.git.checkpoint(ws, 'Initial demo workspace');
      }
    } catch {
      /* git unavailable: the demo still works on a plain folder */
    }
    const existing = (await this.projects.list()).find((p) => p.path === ws);
    const project = existing ?? (await this.projects.create({ name: 'Sync API (demo)', description: 'Demo project with a sample workspace.', path: ws, budgetUsd: 5 }));
    const table = await this.tables.create({ name: 'Design Council', projectId: project.id, templateId: 'design-council' });
    await this.repos.settings.set('onboarded', true);
    return { projectId: project.id, tableId: table.id };
  }

  demoProviderIds() {
    return DEMO_PROVIDER_IDS;
  }

  close() {
    this.database.close();
  }
}

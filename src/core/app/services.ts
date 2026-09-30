import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { AgentSpecSchema, type AgentSpec } from '../agents/types';
import type { GitService } from '../git/service';
import { ProjectInputSchema, type Project, type ProjectInput } from '../projects/types';
import { ConstitutionSchema, type Constitution, type Role } from '../roles/types';
import { PermissionGrantSchema, type PermissionGrant } from '../security/permissions';
import type { AgentsRepo, PermissionsRepo, ProjectsRepo, RolesRepo, TablesRepo } from '../storage/repos/definitions';
import { ProtocolSchema, SeatSchema, type Protocol, type Seat, type Table } from '../teams/types';
import { validateTable } from '../teams/validate';
import type { Clock, IdGenerator } from '../util/runtime';
import { DEFAULT_PROTOCOL, TABLE_TEMPLATES } from './seed';
import { PROJECT_DEFAULT_CEILING } from '../runs/service';
import { z } from 'zod';
import { RuleSchema } from '../governance/types';

export class ProjectService {
  constructor(
    private readonly repo: ProjectsRepo,
    private readonly permissions: PermissionsRepo,
    private readonly git: GitService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  list() {
    return this.repo.list();
  }

  async create(raw: ProjectInput): Promise<Project> {
    const input = ProjectInputSchema.parse(raw);
    let isGit = false;
    if (input.path) {
      if (!isAbsolute(input.path)) throw new Error('Project path must be absolute');
      const info = await stat(input.path).catch(() => null);
      if (!info?.isDirectory()) throw new Error('Project path is not a folder');
      isGit = await this.git.isRepo(input.path);
    }
    const now = this.clock.now();
    const project: Project = { id: this.ids.next('proj'), name: input.name, description: input.description, path: input.path, isGit, budgetUsd: input.budgetUsd, createdAt: now, updatedAt: now };
    await this.repo.upsert(project);
    return project;
  }

  async update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'budgetUsd'>>): Promise<Project> {
    const p = await this.repo.get(id);
    if (!p) throw new Error('Project not found');
    const next = { ...p, ...patch, updatedAt: this.clock.now() };
    await this.repo.upsert(next);
    return next;
  }

  delete(id: string) {
    return this.repo.delete(id);
  }

  async getCeiling(id: string): Promise<PermissionGrant> {
    return (await this.permissions.get('project', id)) ?? PROJECT_DEFAULT_CEILING;
  }

  async setCeiling(id: string, grant: PermissionGrant): Promise<void> {
    await this.permissions.set('project', id, PermissionGrantSchema.parse(grant), this.clock.now());
  }

  async gitStatus(id: string) {
    const p = await this.repo.get(id);
    if (!p?.path || !p.isGit) return null;
    const [branch, status, worktrees] = await Promise.all([this.git.currentBranch(p.path), this.git.status(p.path), this.git.listWorktrees(p.path)]);
    return { branch, changes: status, worktrees };
  }
}

export const TableUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000),
  projectId: z.string().nullable(),
  seats: z.array(SeatSchema),
  protocol: ProtocolSchema,
  rules: z.array(RuleSchema),
});

export class TableService {
  constructor(
    private readonly repo: TablesRepo,
    private readonly roles: RolesRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  list() {
    return this.repo.list();
  }

  get(id: string) {
    return this.repo.get(id);
  }

  templates() {
    return TABLE_TEMPLATES.map(({ id, name, description, seats }) => ({ id, name, description, seats: seats() }));
  }

  async create(input: { name: string; description?: string; projectId?: string | null; templateId?: string }): Promise<Table> {
    const tpl = TABLE_TEMPLATES.find((t) => t.id === (input.templateId ?? 'design-council')) ?? TABLE_TEMPLATES[0]!;
    const now = this.clock.now();
    const table: Table = {
      id: this.ids.next('tbl'),
      name: input.name.trim() || tpl.name,
      description: input.description ?? tpl.description,
      projectId: input.projectId ?? null,
      seats: tpl.seats(),
      protocol: { ...DEFAULT_PROTOCOL },
      rules: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(table);
    return table;
  }

  async update(id: string, raw: z.input<typeof TableUpdateSchema>): Promise<Table> {
    const existing = await this.repo.get(id);
    if (!existing) throw new Error('Table not found');
    const patch = TableUpdateSchema.parse(raw);
    const seats = patch.seats.map((s, i) => ({ ...s, order: i }));
    const ids = new Set(seats.map((s) => s.id));
    if (ids.size !== seats.length) throw new Error('Seat ids must be unique');
    const table: Table = { ...existing, ...patch, seats, updatedAt: this.clock.now() };
    await this.repo.save(table);
    return table;
  }

  async validate(id: string) {
    const table = await this.repo.get(id);
    if (!table) throw new Error('Table not found');
    const roles = await this.roles.list();
    return validateTable(table, new Map(roles.map((r) => [r.id, r])));
  }

  newSeat(existing: Seat[], spec: AgentSpec, sourceAgentId: string | null = null): Seat {
    const base = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'seat';
    let id = base;
    for (let i = 2; existing.some((s) => s.id === id); i++) id = `${base}_${i}`;
    return { id, order: existing.length, spec: AgentSpecSchema.parse(spec), sourceAgentId };
  }

  delete(id: string) {
    return this.repo.delete(id);
  }

  defaultProtocol(): Protocol {
    return { ...DEFAULT_PROTOCOL };
  }
}

export class AgentService {
  constructor(
    private readonly repo: AgentsRepo,
    private readonly roles: RolesRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  list() {
    return this.repo.list();
  }

  async save(id: string | null, raw: AgentSpec) {
    const spec = AgentSpecSchema.parse(raw);
    if (!(await this.roles.get(spec.roleId))) throw new Error('Unknown role');
    const agentId = id ?? this.ids.next('agent');
    await this.repo.upsert(agentId, spec, this.clock.now());
    return (await this.repo.get(agentId))!;
  }

  delete(id: string) {
    return this.repo.delete(id);
  }
}

/**
 * Roles. Built-in constitutions are immutable; users customise by forking into a new role.
 * Editing a custom role bumps its version, which changes its constitution hash.
 */
export class RoleService {
  constructor(
    private readonly repo: RolesRepo,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  list() {
    return this.repo.list();
  }

  async fork(fromId: string, name: string): Promise<Role> {
    const src = await this.repo.get(fromId);
    if (!src) throw new Error('Role not found');
    const role: Role = { id: this.ids.next('role'), name: name.trim() || `${src.name} (custom)`, description: src.description, constitution: structuredClone(src.constitution), builtIn: false, version: 1 };
    await this.repo.upsert(role, this.clock.now());
    return role;
  }

  async update(id: string, patch: { name?: string; description?: string; constitution?: Constitution }): Promise<Role> {
    const role = await this.repo.get(id);
    if (!role) throw new Error('Role not found');
    if (role.builtIn) throw new Error('Built-in constitutions are immutable. Fork the role to customise it.');
    const next: Role = {
      ...role,
      name: patch.name?.trim() || role.name,
      description: patch.description ?? role.description,
      constitution: patch.constitution ? ConstitutionSchema.parse(patch.constitution) : role.constitution,
      version: role.version + 1,
    };
    await this.repo.upsert(next, this.clock.now());
    return next;
  }

  async delete(id: string) {
    const role = await this.repo.get(id);
    if (role?.builtIn) throw new Error('Built-in roles cannot be deleted');
    await this.repo.delete(id);
  }
}

import { asc, eq } from 'drizzle-orm';
import type { Agent, AgentSpec } from '../../agents/types';
import type { Policy, Layer } from '../../governance/types';
import type { Project } from '../../projects/types';
import type { Role } from '../../roles/types';
import type { PermissionGrant } from '../../security/permissions';
import type { Session } from '../../sessions/types';
import type { Table } from '../../teams/types';
import type { PixelDb } from '../db';
import { agents, governancePolicies, permissions, projects, roles, sessions, settings, tableMembers, tables } from '../schema';

export class RolesRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<Role[]> {
    const rows = await this.db.select().from(roles).orderBy(asc(roles.createdAt), asc(roles.name));
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, constitution: r.constitution, builtIn: r.builtIn, version: r.version }));
  }

  async get(id: string): Promise<Role | null> {
    const [r] = await this.db.select().from(roles).where(eq(roles.id, id));
    return r ? { id: r.id, name: r.name, description: r.description, constitution: r.constitution, builtIn: r.builtIn, version: r.version } : null;
  }

  async upsert(role: Role, at: number): Promise<void> {
    const values = { ...role, createdAt: at, updatedAt: at };
    await this.db
      .insert(roles)
      .values(values)
      .onConflictDoUpdate({ target: roles.id, set: { name: role.name, description: role.description, constitution: role.constitution, version: role.version, builtIn: role.builtIn, updatedAt: at } });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(roles).where(eq(roles.id, id));
  }
}

export class AgentsRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<Agent[]> {
    const rows = await this.db.select().from(agents).orderBy(asc(agents.createdAt));
    return rows.map((r) => ({ id: r.id, spec: r.spec, createdAt: r.createdAt, updatedAt: r.updatedAt }));
  }

  async get(id: string): Promise<Agent | null> {
    const [r] = await this.db.select().from(agents).where(eq(agents.id, id));
    return r ? { id: r.id, spec: r.spec, createdAt: r.createdAt, updatedAt: r.updatedAt } : null;
  }

  async upsert(id: string, spec: AgentSpec, at: number): Promise<void> {
    await this.db
      .insert(agents)
      .values({ id, name: spec.name, roleId: spec.roleId, spec, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({ target: agents.id, set: { name: spec.name, roleId: spec.roleId, spec, updatedAt: at } });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id));
  }
}

export class TablesRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<Table[]> {
    const rows = await this.db.select().from(tables).orderBy(asc(tables.createdAt));
    const members = await this.db.select().from(tableMembers).orderBy(asc(tableMembers.ord));
    return rows.map((t) => this.assemble(t, members.filter((m) => m.tableId === t.id)));
  }

  async get(id: string): Promise<Table | null> {
    const [t] = await this.db.select().from(tables).where(eq(tables.id, id));
    if (!t) return null;
    const members = await this.db.select().from(tableMembers).where(eq(tableMembers.tableId, id)).orderBy(asc(tableMembers.ord));
    return this.assemble(t, members);
  }

  /** Saves the table and replaces its seats atomically. */
  async save(table: Table): Promise<void> {
    await this.db.transaction(async (tx) => {
      const values = { id: table.id, name: table.name, description: table.description, projectId: table.projectId, protocol: table.protocol, rules: table.rules, createdAt: table.createdAt, updatedAt: table.updatedAt };
      await tx.insert(tables).values(values).onConflictDoUpdate({ target: tables.id, set: values });
      await tx.delete(tableMembers).where(eq(tableMembers.tableId, table.id));
      if (table.seats.length) {
        await tx.insert(tableMembers).values(
          table.seats.map((s) => ({ id: `${table.id}:${s.id}`, tableId: table.id, ord: s.order, spec: s.spec, authority: s.authority ?? null, sourceAgentId: s.sourceAgentId ?? null })),
        );
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(tables).where(eq(tables.id, id));
  }

  private assemble(t: typeof tables.$inferSelect, members: (typeof tableMembers.$inferSelect)[]): Table {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      projectId: t.projectId,
      protocol: t.protocol,
      rules: t.rules,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      seats: members.map((m) => ({
        id: m.id.slice(t.id.length + 1),
        order: m.ord,
        spec: m.spec,
        ...(m.authority ? { authority: m.authority } : {}),
        sourceAgentId: m.sourceAgentId,
      })),
    };
  }
}

export class ProjectsRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<Project[]> {
    return this.db.select().from(projects).orderBy(asc(projects.createdAt));
  }

  async get(id: string): Promise<Project | null> {
    const [p] = await this.db.select().from(projects).where(eq(projects.id, id));
    return p ?? null;
  }

  async upsert(p: Project): Promise<void> {
    await this.db.insert(projects).values(p).onConflictDoUpdate({ target: projects.id, set: p });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}

export class SessionsRepo {
  constructor(private readonly db: PixelDb) {}

  async list(projectId?: string): Promise<Session[]> {
    const q = this.db.select().from(sessions);
    return projectId ? q.where(eq(sessions.projectId, projectId)).orderBy(asc(sessions.createdAt)) : q.orderBy(asc(sessions.createdAt));
  }

  async upsert(s: Session): Promise<void> {
    await this.db.insert(sessions).values(s).onConflictDoUpdate({ target: sessions.id, set: s });
  }
}

export interface StoredPolicy extends Policy {
  scopeType: 'global' | 'project' | 'table';
  scopeId: string | null;
}

export class PoliciesRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<StoredPolicy[]> {
    const rows = await this.db.select().from(governancePolicies);
    return rows.map((r) => ({ id: r.id, name: r.name, layer: r.layer as Layer, rules: r.rules, locked: r.locked, scopeType: r.scopeType as StoredPolicy['scopeType'], scopeId: r.scopeId }));
  }

  async upsert(p: StoredPolicy, at: number): Promise<void> {
    const values = { id: p.id, name: p.name, layer: p.layer, rules: p.rules, locked: p.locked, scopeType: p.scopeType, scopeId: p.scopeId, updatedAt: at };
    await this.db.insert(governancePolicies).values(values).onConflictDoUpdate({ target: governancePolicies.id, set: values });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(governancePolicies).where(eq(governancePolicies.id, id));
  }
}

export class PermissionsRepo {
  constructor(private readonly db: PixelDb) {}

  async get(subjectType: string, subjectId: string): Promise<PermissionGrant | null> {
    const rows = await this.db.select().from(permissions).where(eq(permissions.subjectId, subjectId));
    return rows.find((r) => r.subjectType === subjectType)?.grant ?? null;
  }

  async set(subjectType: string, subjectId: string, grant: PermissionGrant, at: number): Promise<void> {
    const values = { id: `${subjectType}:${subjectId}`, subjectType, subjectId, grant, updatedAt: at };
    await this.db.insert(permissions).values(values).onConflictDoUpdate({ target: [permissions.subjectType, permissions.subjectId], set: values });
  }
}

export class SettingsRepo {
  constructor(private readonly db: PixelDb) {}

  async get<T>(key: string): Promise<T | undefined> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key));
    return row?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}

import { asc, eq } from 'drizzle-orm';
import type { Workflow } from '../../workflows/types';
import type { PixelDb } from '../db';
import { workflowEdges, workflowNodes, workflows } from '../schema';

export class WorkflowsRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<Workflow[]> {
    const rows = await this.db.select().from(workflows).orderBy(asc(workflows.createdAt));
    return Promise.all(rows.map((r) => this.assemble(r)));
  }

  async get(id: string): Promise<Workflow | null> {
    const [r] = await this.db.select().from(workflows).where(eq(workflows.id, id));
    return r ? this.assemble(r) : null;
  }

  async save(wf: Workflow): Promise<void> {
    await this.db.transaction(async (tx) => {
      const values = { id: wf.id, name: wf.name, description: wf.description, projectId: wf.projectId, createdAt: wf.createdAt, updatedAt: wf.updatedAt };
      await tx.insert(workflows).values(values).onConflictDoUpdate({ target: workflows.id, set: values });
      await tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, wf.id));
      await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, wf.id));
      if (wf.nodes.length) await tx.insert(workflowNodes).values(wf.nodes.map((n) => ({ ...n, workflowId: wf.id })));
      if (wf.edges.length) await tx.insert(workflowEdges).values(wf.edges.map((e) => ({ ...e, workflowId: wf.id })));
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workflows).where(eq(workflows.id, id));
  }

  private async assemble(r: typeof workflows.$inferSelect): Promise<Workflow> {
    const nodes = await this.db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, r.id));
    const edges = await this.db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, r.id));
    return {
      ...r,
      nodes: nodes.map(({ workflowId: _w, ...n }) => ({ ...n, type: n.type as Workflow['nodes'][number]['type'] })),
      edges: edges.map(({ workflowId: _w, ...e }) => ({ ...e, branch: (e.branch as 'true' | 'false' | null) ?? null })),
    };
  }
}

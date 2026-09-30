import { z } from 'zod';

export const NODE_TYPES = ['start', 'agent', 'table', 'parallel', 'sequential', 'condition', 'review', 'judge', 'approval', 'tool', 'browser', 'mac', 'git', 'loop', 'wait', 'end'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(NODE_TYPES),
  label: z.string().max(80).default(''),
  config: z.record(z.string(), z.unknown()).default({}),
  x: z.number().default(0),
  y: z.number().default(0),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** Only for edges leaving a CONDITION node. */
  branch: z.enum(['true', 'false']).nullable().default(null),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export interface Workflow {
  id: string;
  name: string;
  description: string;
  projectId: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: number;
  updatedAt: number;
}

/** Per-node execution policy, read from node.config. */
export interface NodePolicy {
  retries: number;
  timeoutMs: number | null;
  onFailure: 'fail' | 'continue';
}

export function nodePolicy(node: WorkflowNode): NodePolicy {
  const c = node.config;
  return {
    retries: typeof c.retries === 'number' ? Math.max(0, Math.min(5, Math.floor(c.retries))) : 0,
    timeoutMs: typeof c.timeoutMs === 'number' && c.timeoutMs > 0 ? Math.min(c.timeoutMs, 30 * 60_000) : null,
    onFailure: c.onFailure === 'continue' ? 'continue' : 'fail',
  };
}

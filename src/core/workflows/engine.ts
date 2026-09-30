import { AbortError, sleep } from '../util/runtime';
import { nodePolicy, type Workflow, type WorkflowEdge, type WorkflowNode } from './types';

export interface WorkflowValidation {
  ok: boolean;
  errors: string[];
}

/** Structural validation: one START, ≥1 END, acyclic, everything reachable, well-formed conditions. */
export function validateWorkflow(wf: Pick<Workflow, 'nodes' | 'edges'>): WorkflowValidation {
  const errors: string[] = [];
  const ids = new Set(wf.nodes.map((n) => n.id));
  if (ids.size !== wf.nodes.length) errors.push('Node ids must be unique');
  const starts = wf.nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) errors.push('A workflow needs exactly one START node');
  if (!wf.nodes.some((n) => n.type === 'end')) errors.push('A workflow needs at least one END node');
  for (const e of wf.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`Edge ${e.id} references a missing node`);
    if (e.source === e.target) errors.push(`Edge ${e.id} is a self-loop (use a LOOP node instead)`);
  }
  for (const n of wf.nodes) {
    const out = wf.edges.filter((e) => e.source === n.id);
    const inc = wf.edges.filter((e) => e.target === n.id);
    if (n.type === 'start' && inc.length) errors.push('START cannot have incoming edges');
    if (n.type === 'end' && out.length) errors.push('END cannot have outgoing edges');
    if (n.type !== 'start' && inc.length === 0) errors.push(`${label(n)} has no incoming edge`);
    if (n.type !== 'end' && out.length === 0) errors.push(`${label(n)} has no outgoing edge`);
    if (n.type === 'condition') {
      if (!out.some((e) => e.branch === 'true') || !out.some((e) => e.branch === 'false')) errors.push(`${label(n)} needs a true and a false branch`);
    } else if (out.some((e) => e.branch)) errors.push(`Only CONDITION nodes may have branch edges (${label(n)})`);
  }
  if (errors.length === 0 && hasCycle(wf.nodes, wf.edges)) errors.push('Workflows must be acyclic (use a LOOP node for repetition)');
  if (errors.length === 0 && starts[0]) {
    const reach = reachable(starts[0].id, wf.edges);
    for (const n of wf.nodes) if (!reach.has(n.id)) errors.push(`${label(n)} is unreachable from START`);
  }
  return { ok: errors.length === 0, errors };
}

function label(n: WorkflowNode) {
  return `${n.type.toUpperCase()} "${n.label || n.id}"`;
}

function hasCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const e of edges) if (e.source === id && visit(e.target)) return true;
    state.set(id, 2);
    return false;
  };
  return nodes.some((n) => visit(n.id));
}

function reachable(start: string, edges: WorkflowEdge[]): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) if (e.source === id && !seen.has(e.target)) {
      seen.add(e.target);
      queue.push(e.target);
    }
  }
  return seen;
}

export type NodeState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeContext {
  node: WorkflowNode;
  task: string;
  /** Outputs of completed direct predecessors (keyed by node id). */
  inputs: Record<string, unknown>;
  /** Outputs of every completed node so far. */
  outputs: Record<string, unknown>;
  attempt: number;
  signal: AbortSignal;
  /** Re-run another node's executor (used by LOOP). */
  rerun(nodeId: string, extraTask: string): Promise<unknown>;
}

export type NodeExecutor = (ctx: NodeContext) => Promise<unknown>;

export interface EngineHooks {
  onNode?(nodeId: string, state: NodeState, info: { output?: unknown; error?: string; attempt?: number }): void;
}

export interface WorkflowResult {
  status: 'completed' | 'failed' | 'cancelled';
  states: Record<string, NodeState>;
  outputs: Record<string, unknown>;
  errors: Record<string, string>;
}

/**
 * Dependency-driven DAG executor. A node runs once every non-skipped predecessor has finished;
 * independent branches run concurrently. CONDITION nodes skip the branch not taken, and a node
 * whose every incoming edge is skipped is itself skipped. Retries, timeouts and cancellation are per node.
 */
export async function executeWorkflow(
  wf: Pick<Workflow, 'nodes' | 'edges'>,
  task: string,
  executors: Partial<Record<WorkflowNode['type'], NodeExecutor>>,
  signal: AbortSignal,
  hooks: EngineHooks = {},
): Promise<WorkflowResult> {
  const v = validateWorkflow(wf);
  if (!v.ok) throw new Error(`Invalid workflow: ${v.errors.join('; ')}`);

  const nodes = new Map(wf.nodes.map((n) => [n.id, n]));
  const states: Record<string, NodeState> = Object.fromEntries(wf.nodes.map((n) => [n.id, 'pending']));
  const outputs: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const skippedEdges = new Set<string>();
  const incoming = (id: string) => wf.edges.filter((e) => e.target === id);
  const outgoing = (id: string) => wf.edges.filter((e) => e.source === id);
  const failFast = new AbortController();
  const combined = AbortSignal.any([signal, failFast.signal]);

  const set = (id: string, s: NodeState, info: { output?: unknown; error?: string; attempt?: number } = {}) => {
    states[id] = s;
    hooks.onNode?.(id, s, info);
  };

  const runNode = async (node: WorkflowNode, extraTask = ''): Promise<unknown> => {
    const exec = executors[node.type];
    if (!exec) throw new Error(`No executor for ${node.type}`);
    const policy = nodePolicy(node);
    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.retries + 1; attempt++) {
      if (combined.aborted) throw new AbortError();
      const nodeSignal = policy.timeoutMs ? AbortSignal.any([combined, AbortSignal.timeout(policy.timeoutMs)]) : combined;
      try {
        const inputs = Object.fromEntries(incoming(node.id).filter((e) => states[e.source] === 'completed').map((e) => [e.source, outputs[e.source]]));
        return await exec({
          node,
          task: extraTask ? `${task}\n\n${extraTask}` : task,
          inputs,
          outputs,
          attempt,
          signal: nodeSignal,
          rerun: (id, extra) => runNode(nodes.get(id)!, extra),
        });
      } catch (err) {
        lastError = err;
        if (combined.aborted) throw new AbortError();
        if (attempt <= policy.retries) {
          hooks.onNode?.(node.id, 'running', { error: `Attempt ${attempt} failed: ${(err as Error).message}`, attempt: attempt + 1 });
          await sleep(Math.min(250 * 2 ** (attempt - 1), 4000), combined);
        }
      }
    }
    const e = lastError as Error;
    throw e?.name === 'TimeoutError' ? new Error(`Timed out after ${policy.timeoutMs}ms`) : e;
  };

  const ready = (id: string) => {
    const inc = incoming(id);
    if (inc.some((e) => !skippedEdges.has(e.id) && states[e.source] !== 'completed' && states[e.source] !== 'failed')) return false;
    return states[id] === 'pending';
  };

  const settle = (id: string) => {
    const node = nodes.get(id)!;
    for (const e of outgoing(id)) {
      if (states[id] === 'skipped') skippedEdges.add(e.id);
      else if (node.type === 'condition') {
        const taken = (outputs[id] as { result?: boolean } | undefined)?.result === true ? 'true' : 'false';
        if (e.branch !== taken) skippedEdges.add(e.id);
      }
    }
  };

  const running = new Map<string, Promise<void>>();
  let fatal: string | null = null;

  const schedule = () => {
    if (fatal || combined.aborted) return;
    for (const node of wf.nodes) {
      if (states[node.id] !== 'pending' || running.has(node.id) || !ready(node.id)) continue;
      const inc = incoming(node.id);
      if (inc.length > 0 && inc.every((e) => skippedEdges.has(e.id))) {
        set(node.id, 'skipped');
        settle(node.id);
        continue;
      }
      set(node.id, 'running', { attempt: 1 });
      const p = runNode(node)
        .then((out) => {
          outputs[node.id] = out;
          set(node.id, 'completed', { output: out });
        })
        .catch((err: Error) => {
          errors[node.id] = err.message;
          set(node.id, 'failed', { error: err.message });
          if (!(err instanceof AbortError) && nodePolicy(node).onFailure === 'fail') {
            fatal ??= `${node.label || node.id}: ${err.message}`;
            failFast.abort();
          } else {
            outputs[node.id] = { error: err.message };
          }
        })
        .finally(() => {
          settle(node.id);
          running.delete(node.id);
        });
      running.set(node.id, p);
    }
  };

  for (;;) {
    schedule();
    // Skips can cascade synchronously; reschedule until stable.
    let before = -1;
    while (before !== Object.values(states).filter((s) => s === 'skipped').length) {
      before = Object.values(states).filter((s) => s === 'skipped').length;
      schedule();
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  if (signal.aborted) return { status: 'cancelled', states, outputs, errors };
  if (fatal) return { status: 'failed', states, outputs, errors };
  return { status: 'completed', states, outputs, errors };
}

/** Evaluate a CONDITION node's config against prior outputs. No code evaluation — a fixed operator set. */
export function evaluateCondition(config: Record<string, unknown>, outputs: Record<string, unknown>): boolean {
  const path = String(config.path ?? '');
  const op = String(config.op ?? 'truthy');
  const expected = config.value;
  const actual = path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && Object.hasOwn(acc, key) ? (acc as Record<string, unknown>)[key] : undefined), outputs);
  switch (op) {
    case 'eq':
      return actual === expected || String(actual) === String(expected);
    case 'neq':
      return !(actual === expected || String(actual) === String(expected));
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'contains':
      return typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) ? actual.includes(expected) : false;
    case 'truthy':
    default:
      return !!actual;
  }
}

import { describe, expect, it } from 'vitest';
import { evaluateCondition, executeWorkflow, validateWorkflow, type NodeExecutor } from './engine';
import type { WorkflowEdge, WorkflowNode } from './types';

const n = (id: string, type: WorkflowNode['type'], config: Record<string, unknown> = {}): WorkflowNode => ({ id, type, label: id, config, x: 0, y: 0 });
const e = (source: string, target: string, branch: 'true' | 'false' | null = null): WorkflowEdge => ({ id: `${source}->${target}`, source, target, branch });

const echo: NodeExecutor = async (ctx) => ({ node: ctx.node.id, inputs: Object.keys(ctx.inputs) });

describe('workflow validation', () => {
  it('accepts a well-formed DAG', () => {
    expect(validateWorkflow({ nodes: [n('s', 'start'), n('a', 'agent'), n('z', 'end')], edges: [e('s', 'a'), e('a', 'z')] }).ok).toBe(true);
  });

  it('rejects cycles, missing START/END, dangling and unreachable nodes, bad conditions', () => {
    expect(validateWorkflow({ nodes: [n('s', 'start'), n('a', 'agent'), n('b', 'agent'), n('z', 'end')], edges: [e('s', 'a'), e('a', 'b'), e('b', 'a'), e('b', 'z')] }).errors.join()).toMatch(/acyclic/);
    expect(validateWorkflow({ nodes: [n('a', 'agent')], edges: [] }).errors.join()).toMatch(/START/);
    expect(validateWorkflow({ nodes: [n('s', 'start'), n('c', 'condition'), n('z', 'end')], edges: [e('s', 'c'), e('c', 'z', 'true')] }).errors.join()).toMatch(/true and a false/);
    expect(validateWorkflow({ nodes: [n('s', 'start'), n('a', 'agent'), n('z', 'end')], edges: [e('s', 'z')] }).errors.join()).toMatch(/no incoming/);
  });
});

describe('workflow execution', () => {
  it('runs parallel branches concurrently and joins', async () => {
    const order: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const slow: NodeExecutor = async (ctx) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      order.push(`start:${ctx.node.id}`);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return { id: ctx.node.id };
    };
    const wf = {
      nodes: [n('s', 'start'), n('p', 'parallel'), n('a', 'agent'), n('b', 'agent'), n('j', 'judge'), n('z', 'end')],
      edges: [e('s', 'p'), e('p', 'a'), e('p', 'b'), e('a', 'j'), e('b', 'j'), e('j', 'z')],
    };
    const res = await executeWorkflow(wf, 'task', { start: echo, parallel: echo, agent: slow, judge: echo, end: echo }, new AbortController().signal);
    expect(res.status).toBe('completed');
    expect(maxConcurrent).toBe(2);
    expect((res.outputs.j as { inputs: string[] }).inputs.sort()).toEqual(['a', 'b']);
  });

  it('takes only the chosen CONDITION branch and skips the other (and its descendants)', async () => {
    const wf = {
      nodes: [n('s', 'start'), n('a', 'agent'), n('c', 'condition', { path: 'a.score', op: 'gt', value: 5 }), n('yes', 'agent'), n('no', 'agent'), n('no2', 'agent'), n('z1', 'end'), n('z2', 'end')],
      edges: [e('s', 'a'), e('a', 'c'), e('c', 'yes', 'true'), e('c', 'no', 'false'), e('no', 'no2'), e('yes', 'z1'), e('no2', 'z2')],
    };
    const res = await executeWorkflow(
      wf,
      't',
      { start: echo, agent: async (ctx) => (ctx.node.id === 'a' ? { score: 9 } : { id: ctx.node.id }), condition: async (ctx) => ({ result: evaluateCondition(ctx.node.config, ctx.outputs) }), end: echo },
      new AbortController().signal,
    );
    expect(res.states).toMatchObject({ yes: 'completed', no: 'skipped', no2: 'skipped', z1: 'completed', z2: 'skipped' });
  });

  it('a join after a condition runs with whichever branch was taken', async () => {
    const wf = {
      nodes: [n('s', 'start'), n('c', 'condition', { path: 's.task', op: 'eq', value: 'go' }), n('a', 'agent'), n('b', 'agent'), n('z', 'end')],
      edges: [e('s', 'c'), e('c', 'a', 'true'), e('c', 'b', 'false'), e('a', 'z'), e('b', 'z')],
    };
    const res = await executeWorkflow(wf, 'go', { start: async (ctx) => ({ task: ctx.task }), condition: async (ctx) => ({ result: evaluateCondition(ctx.node.config, ctx.outputs) }), agent: echo, end: echo }, new AbortController().signal);
    expect(res.states).toMatchObject({ a: 'completed', b: 'skipped', z: 'completed' });
  });

  it('retries failing nodes, then succeeds', async () => {
    let calls = 0;
    const flaky: NodeExecutor = async () => {
      if (++calls < 3) throw new Error('flaky');
      return { ok: true };
    };
    const wf = { nodes: [n('s', 'start'), n('a', 'agent', { retries: 2 }), n('z', 'end')], edges: [e('s', 'a'), e('a', 'z')] };
    const res = await executeWorkflow(wf, 't', { start: echo, agent: flaky, end: echo }, new AbortController().signal);
    expect(res.status).toBe('completed');
    expect(calls).toBe(3);
  });

  it('fails the workflow on a failing node, unless onFailure=continue', async () => {
    const boom: NodeExecutor = async () => {
      throw new Error('boom');
    };
    const wf = (onFailure: string) => ({ nodes: [n('s', 'start'), n('a', 'agent', { onFailure }), n('z', 'end')], edges: [e('s', 'a'), e('a', 'z')] });
    const failed = await executeWorkflow(wf('fail'), 't', { start: echo, agent: boom, end: echo }, new AbortController().signal);
    expect(failed.status).toBe('failed');
    expect(failed.states.z).toBe('pending');
    const cont = await executeWorkflow(wf('continue'), 't', { start: echo, agent: boom, end: echo }, new AbortController().signal);
    expect(cont.status).toBe('completed');
    expect(cont.states).toMatchObject({ a: 'failed', z: 'completed' });
  });

  it('enforces per-node timeouts', async () => {
    const hang: NodeExecutor = (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(ctx.signal.reason)));
    const wf = { nodes: [n('s', 'start'), n('a', 'agent', { timeoutMs: 30 }), n('z', 'end')], edges: [e('s', 'a'), e('a', 'z')] };
    const res = await executeWorkflow(wf, 't', { start: echo, agent: hang, end: echo }, new AbortController().signal);
    expect(res.status).toBe('failed');
    expect(res.errors.a).toMatch(/Timed out/);
  });

  it('cancels', async () => {
    const ac = new AbortController();
    const hang: NodeExecutor = (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const wf = { nodes: [n('s', 'start'), n('a', 'agent'), n('z', 'end')], edges: [e('s', 'a'), e('a', 'z')] };
    const p = executeWorkflow(wf, 't', { start: echo, agent: hang, end: echo }, ac.signal);
    setTimeout(() => ac.abort(), 20);
    expect((await p).status).toBe('cancelled');
  });

  it('condition operators are a fixed, safe set', () => {
    const out = { a: { n: 3, s: 'hello', l: ['x'], ok: true } };
    expect(evaluateCondition({ path: 'a.n', op: 'gt', value: 2 }, out)).toBe(true);
    expect(evaluateCondition({ path: 'a.n', op: 'lt', value: 2 }, out)).toBe(false);
    expect(evaluateCondition({ path: 'a.s', op: 'contains', value: 'ell' }, out)).toBe(true);
    expect(evaluateCondition({ path: 'a.l', op: 'contains', value: 'x' }, out)).toBe(true);
    expect(evaluateCondition({ path: 'a.ok' }, out)).toBe(true);
    expect(evaluateCondition({ path: 'a.missing.deep', op: 'eq', value: 'undefined' }, out)).toBe(true);
    expect(evaluateCondition({ path: 'constructor', op: 'truthy' }, {})).toBe(false); // own properties only; no prototype access
  });
});

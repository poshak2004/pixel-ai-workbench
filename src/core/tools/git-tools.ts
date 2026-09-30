import { z } from 'zod';
import type { GitService } from '../git/service';
import type { Tool } from './types';

const Empty = z.object({}).passthrough();

export function gitTools(git: GitService): Tool<any>[] {
  const status: Tool<z.infer<typeof Empty>> = {
    name: 'git_status',
    description: 'Show changed files in the workspace (git status).',
    actionKind: 'git.read',
    input: Empty,
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
    paths: () => [],
    async run(_args, ctx) {
      if (!ctx.root) throw new Error('No workspace attached');
      const entries = await git.status(ctx.root);
      return entries.length ? entries.map((e) => `${e.index}${e.worktree} ${e.path}`).join('\n') : 'clean';
    },
  };
  const diff: Tool<z.infer<typeof Empty>> = {
    name: 'git_diff',
    description: 'Show the diff of uncommitted workspace changes.',
    actionKind: 'git.read',
    input: Empty,
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
    paths: () => [],
    async run(_args, ctx) {
      if (!ctx.root) throw new Error('No workspace attached');
      const d = await git.diff(ctx.root);
      return d.length > 32_000 ? `${d.slice(0, 32_000)}\n…[truncated]` : d || 'no changes';
    },
  };
  return [status, diff];
}

import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext } from './types';

export class PathEscapeError extends Error {
  constructor(p: string) {
    super(`Path escapes the workspace: ${p}`);
    this.name = 'PathEscapeError';
  }
}

/** Normalise a user/model supplied path to a workspace-relative POSIX path, rejecting escapes. */
export function normaliseRelative(p: string): string {
  if (isAbsolute(p)) throw new PathEscapeError(p);
  const resolved = resolve('/__ws__', p);
  if (resolved !== '/__ws__' && !resolved.startsWith('/__ws__/')) throw new PathEscapeError(p);
  return resolved === '/__ws__' ? '.' : resolved.slice('/__ws__/'.length);
}

/** Resolve inside root, following symlinks of the deepest existing ancestor to block symlink escapes. */
export async function resolveInside(root: string, p: string): Promise<string> {
  const rel = normaliseRelative(p);
  const realRoot = await realpath(root);
  const target = resolve(realRoot, rel);
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      const within = real === realRoot || real.startsWith(realRoot + sep);
      if (!within) throw new PathEscapeError(p);
      return probe === target ? real : resolve(real, relative(probe, target));
    } catch (err) {
      if (err instanceof PathEscapeError) throw err;
      const parent = dirname(probe);
      if (parent === probe) throw new PathEscapeError(p);
      probe = parent;
    }
  }
}

function requireRoot(ctx: ToolContext): string {
  if (!ctx.root) throw new Error('No workspace is attached to this run');
  return ctx.root;
}

const MAX_READ_BYTES = 64 * 1024;

const ReadArgs = z.object({ path: z.string().min(1) });
export const readFileTool: Tool<z.infer<typeof ReadArgs>> = {
  name: 'fs_read_file',
  description: 'Read a UTF-8 text file from the workspace (max 64 KB).',
  actionKind: 'fs.read',
  input: ReadArgs,
  jsonSchema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative path' } }, required: ['path'], additionalProperties: false },
  paths: (a) => [normaliseRelative(a.path)],
  async run(args, ctx) {
    const abs = await resolveInside(requireRoot(ctx), args.path);
    const info = await stat(abs);
    if (!info.isFile()) throw new Error(`${args.path} is not a file`);
    const buf = await readFile(abs);
    const truncated = buf.byteLength > MAX_READ_BYTES;
    return buf.subarray(0, MAX_READ_BYTES).toString('utf8') + (truncated ? `\n…[truncated ${buf.byteLength - MAX_READ_BYTES} bytes]` : '');
  },
};

const ListArgs = z.object({ path: z.string().default('.') });
export const listDirTool: Tool<z.infer<typeof ListArgs>> = {
  name: 'fs_list_dir',
  description: 'List entries of a workspace directory.',
  actionKind: 'fs.read',
  input: ListArgs,
  jsonSchema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative directory, default "."' } }, additionalProperties: false },
  paths: (a) => [normaliseRelative(a.path)],
  async run(args, ctx) {
    const abs = await resolveInside(requireRoot(ctx), args.path);
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500)
      .map((e) => `${e.isDirectory() ? 'dir ' : 'file'}  ${e.name}`)
      .join('\n');
  },
};

const WriteArgs = z.object({ path: z.string().min(1), content: z.string().max(1_000_000) });
export const writeFileTool: Tool<z.infer<typeof WriteArgs>> = {
  name: 'fs_write_file',
  description: 'Create or overwrite a UTF-8 text file in the workspace.',
  actionKind: 'fs.write',
  input: WriteArgs,
  jsonSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  paths: (a) => [normaliseRelative(a.path)],
  async run(args, ctx) {
    const abs = await resolveInside(requireRoot(ctx), args.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, args.content, 'utf8');
    return `Wrote ${Buffer.byteLength(args.content)} bytes to ${normaliseRelative(args.path)}`;
  },
};

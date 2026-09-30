import { execFile } from 'node:child_process';
import { z } from 'zod';
import { governedPaths, PathEscapeError } from './fs';
import type { Tool, ToolContext } from './types';

const Args = z.object({
  command: z.string().min(1).max(200),
  args: z.array(z.string().max(1000)).max(50).default([]),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
});

/**
 * Development tools an agent may invoke by bare name. Shells, network clients and privilege tools
 * are deliberately absent: a shell would bypass every argument check below.
 */
export const ALLOWED_COMMANDS = new Set([
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'tsc', 'eslint', 'prettier', 'vitest', 'jest',
  'python', 'python3', 'pytest', 'pip', 'pip3', 'uv', 'ruff', 'mypy', 'cargo', 'rustc', 'go', 'make', 'cmake',
  'swift', 'xcodebuild', 'mvn', 'gradle', 'ruby', 'bundle', 'rake',
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'diff', 'echo', 'pwd', 'sort', 'uniq', 'tree', 'stat', 'file',
]);

/** Flags that turn an interpreter into "run this inline code", or a tool into a command runner. */
const FORBIDDEN_FLAGS: Record<string, RegExp> = {
  node: /^(-e|--eval|-p|--print|-r|--require|--import|--loader|--inspect.*)(=|$)/,
  deno: /^(eval)$/,
  bun: /^(-e|--eval|-p|--print)(=|$)/,
  python: /^-c$/,
  python3: /^-c$/,
  ruby: /^-e$/,
  find: /^-(exec|execdir|ok|okdir|delete|fprint.*)$/,
  git: /^(-c|--config-env|--exec-path.*|--upload-pack.*|--receive-pack.*|--ext-cmd.*)$|^core\./,
  npx: /^(-c|--call)(=|$)/,
  make: /^(-f|--file|--makefile)(=|$)/,
};

/**
 * Validate a shell call and return every path-like argument (plus its real location) so governance
 * can apply protected-path rules. Throws on anything that could escape the workspace.
 */
export async function shellPaths(a: z.infer<typeof Args>, ctx: ToolContext): Promise<string[]> {
  if (!/^[A-Za-z0-9._-]+$/.test(a.command)) throw new Error('Command must be a bare program name (no paths)');
  if (!ALLOWED_COMMANDS.has(a.command)) throw new Error(`${a.command} is not an allowed command. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`);
  const forbidden = FORBIDDEN_FLAGS[a.command];
  const paths = new Set<string>(['.']);
  for (const arg of a.args) {
    if (forbidden?.test(arg)) throw new Error(`Argument ${arg} is not allowed for ${a.command}`);
    // For "--opt=value", check the value; bare flags carry no path.
    const value = arg.startsWith('-') ? (arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : '') : arg;
    if (!value) continue;
    if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) throw new PathEscapeError(value);
    if (/[$`]/.test(value)) throw new Error('Shell expansion characters are not allowed in arguments');
    try {
      for (const p of await governedPaths(value, ctx)) paths.add(p);
    } catch (err) {
      if (err instanceof PathEscapeError) throw err;
      paths.add(value);
    }
  }
  return [...paths];
}

/**
 * Executes one allow-listed program with an argument array inside the workspace — no shell
 * interpolation, scrubbed environment, bounded time and output. Always subject to terminal
 * permission and governance (approval by default).
 */
export const shellExecTool: Tool<z.infer<typeof Args>> = {
  name: 'shell_exec',
  description: `Run an allow-listed development program with arguments in the workspace (no shell, no absolute paths). Example: {"command":"npm","args":["test"]}. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}.`,
  actionKind: 'shell.exec',
  input: Args,
  jsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } },
      timeoutMs: { type: 'number' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  paths: shellPaths,
  async run(args, ctx) {
    if (!ctx.root) throw new Error('No workspace attached');
    await shellPaths(args, ctx);
    return new Promise((resolve) => {
      execFile(
        args.command,
        args.args,
        {
          cwd: ctx.root!,
          timeout: args.timeoutMs,
          signal: ctx.signal,
          maxBuffer: 2 * 1024 * 1024,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '', LANG: 'en_US.UTF-8', CI: '1', GIT_TERMINAL_PROMPT: '0' },
        },
        (err, stdout, stderr) => {
          const code = err ? ((err as NodeJS.ErrnoException & { code?: number | string }).code ?? 1) : 0;
          resolve(`exit: ${code}\n--- stdout ---\n${stdout.slice(-16_000)}\n--- stderr ---\n${stderr.slice(-8_000)}`);
        },
      );
    });
  },
};

import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from './types';

const Args = z.object({
  command: z.string().min(1).max(200),
  args: z.array(z.string().max(1000)).max(50).default([]),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
});

/**
 * Executes a single program with an argument array inside the workspace — no shell interpolation,
 * scrubbed environment, bounded time and output. Always subject to terminal permission + governance.
 */
export const shellExecTool: Tool<z.infer<typeof Args>> = {
  name: 'shell_exec',
  description: 'Run a program with arguments in the workspace directory (no shell expansion). Example: {"command":"npm","args":["test"]}',
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
  paths: () => ['.'],
  run(args, ctx) {
    if (!ctx.root) throw new Error('No workspace attached');
    return new Promise((resolve) => {
      execFile(
        args.command,
        args.args,
        {
          cwd: ctx.root!,
          timeout: args.timeoutMs,
          signal: ctx.signal,
          maxBuffer: 2 * 1024 * 1024,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '', LANG: 'en_US.UTF-8', CI: '1' },
        },
        (err, stdout, stderr) => {
          const code = err ? ((err as NodeJS.ErrnoException & { code?: number | string }).code ?? 1) : 0;
          const out = `exit: ${code}\n--- stdout ---\n${stdout.slice(-16_000)}\n--- stderr ---\n${stderr.slice(-8_000)}`;
          resolve(out);
        },
      );
    });
  },
};

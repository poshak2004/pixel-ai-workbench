import type { z } from 'zod';
import type { ActionKind } from '../roles/types';
import type { ToolSpec } from '../providers/types';

export interface ToolContext {
  /** Workspace root the agent operates in (project dir or isolated worktree). */
  root: string | null;
  signal?: AbortSignal;
}

/**
 * A tool is reasoning-free local execution. It declares the kind of action it performs and the
 * paths it touches so the governance layer can decide before anything runs.
 */
export interface Tool<A = Record<string, unknown>> {
  name: string;
  description: string;
  actionKind: ActionKind;
  input: z.ZodType<A>;
  jsonSchema: Record<string, unknown>;
  /** Workspace-relative paths the call would touch (for protected-path rules). */
  paths(args: A): string[];
  run(args: A, ctx: ToolContext): Promise<string>;
}

export function toolSpec(tool: Tool<any>): ToolSpec {
  return { name: tool.name, description: tool.description, inputSchema: tool.jsonSchema };
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<any>>();

  register(tool: Tool<any>): this {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`Invalid tool name ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool<any> | undefined {
    return this.tools.get(name);
  }

  list(): Tool<any>[] {
    return [...this.tools.values()];
  }
}

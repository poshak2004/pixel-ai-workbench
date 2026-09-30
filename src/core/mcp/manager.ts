import { z } from 'zod';
import type { CredentialStore } from '../security/credentials';
import type { SecretRedactor } from '../security/redaction';
import type { SettingsRepo } from '../storage/repos/definitions';
import type { Tool, ToolRegistry } from '../tools/types';
import type { IdGenerator } from '../util/runtime';
import { McpStdioClient, type McpToolInfo } from './client';

export const McpServerInputSchema = z.object({
  name: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9 _-]+$/, 'Letters, numbers, spaces, - and _ only'),
  command: z.string().trim().min(1).max(300),
  args: z.array(z.string().max(1000)).max(40).default([]),
  /** Non-secret environment variables. */
  env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(2000)).default({}),
  /** Names of env vars whose values live in the Keychain. */
  secretEnvKeys: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(20).default([]),
  enabled: z.boolean().default(true),
});
export type McpServerInput = z.infer<typeof McpServerInputSchema>;
export interface McpServerConfig extends McpServerInput {
  id: string;
}

export interface McpServerStatus {
  config: McpServerConfig;
  connected: boolean;
  serverInfo: { name?: string; version?: string };
  tools: { name: string; toolName: string; description: string }[];
  error: string | null;
  secretsStored: string[];
}

const KEY = 'mcp.servers';

/**
 * Manages MCP servers. Connected servers' tools are registered into PIXEL's tool registry as
 * `mcp_<server>_<tool>` with action kind `mcp.call`, so every call passes permissions + governance.
 */
export class McpManager {
  private readonly clients = new Map<string, { client: McpStdioClient; tools: McpToolInfo[]; registered: string[] }>();
  private readonly errors = new Map<string, string>();

  constructor(
    private readonly settings: SettingsRepo,
    private readonly credentials: CredentialStore,
    private readonly redactor: SecretRedactor,
    private readonly tools: ToolRegistry,
    private readonly ids: IdGenerator,
  ) {}

  async list(): Promise<McpServerStatus[]> {
    const configs = await this.configs();
    return Promise.all(
      configs.map(async (config) => {
        const c = this.clients.get(config.id);
        const secretsStored: string[] = [];
        for (const k of config.secretEnvKeys) if (await this.credentials.get(this.secretAccount(config.id, k))) secretsStored.push(k);
        return {
          config,
          connected: !!c?.client.alive,
          serverInfo: c?.client.serverInfo ?? {},
          tools: (c?.tools ?? []).map((t) => ({ name: t.name, toolName: this.toolName(config, t.name), description: t.description })),
          error: this.errors.get(config.id) ?? null,
          secretsStored,
        };
      }),
    );
  }

  async add(raw: McpServerInput): Promise<McpServerConfig> {
    const input = McpServerInputSchema.parse(raw);
    const configs = await this.configs();
    const cfg: McpServerConfig = { ...input, id: this.ids.next('mcp') };
    await this.settings.set(KEY, [...configs, cfg]);
    return cfg;
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id);
    const configs = await this.configs();
    const cfg = configs.find((c) => c.id === id);
    for (const k of cfg?.secretEnvKeys ?? []) await this.credentials.delete(this.secretAccount(id, k));
    await this.settings.set(KEY, configs.filter((c) => c.id !== id));
  }

  async setSecret(id: string, key: string, value: string): Promise<void> {
    const cfg = (await this.configs()).find((c) => c.id === id);
    if (!cfg?.secretEnvKeys.includes(key)) throw new Error(`${key} is not a declared secret for this server`);
    await this.credentials.set(this.secretAccount(id, key), value);
    this.redactor.register(value);
  }

  async connect(id: string): Promise<McpServerStatus> {
    const cfg = (await this.configs()).find((c) => c.id === id);
    if (!cfg) throw new Error('MCP server not found');
    await this.disconnect(id);
    this.errors.delete(id);
    const env: Record<string, string> = { ...cfg.env };
    for (const k of cfg.secretEnvKeys) {
      const v = await this.credentials.get(this.secretAccount(id, k));
      if (!v) throw new Error(`Secret ${k} is not set`);
      this.redactor.register(v);
      env[k] = v;
    }
    const client = new McpStdioClient(cfg.command, cfg.args, env);
    try {
      await client.connect();
      const tools = await client.listTools();
      const registered: string[] = [];
      for (const t of tools) {
        const tool = this.wrap(cfg, client, t);
        this.tools.register(tool);
        registered.push(tool.name);
      }
      this.clients.set(id, { client, tools, registered });
    } catch (err) {
      client.close();
      const msg = this.redactor.redactString((err as Error).message);
      this.errors.set(id, msg);
      throw new Error(msg);
    }
    return (await this.list()).find((s) => s.config.id === id)!;
  }

  async disconnect(id: string): Promise<void> {
    const c = this.clients.get(id);
    if (!c) return;
    for (const name of c.registered) this.tools.unregister(name);
    c.client.close();
    this.clients.delete(id);
  }

  closeAll() {
    for (const id of [...this.clients.keys()]) void this.disconnect(id);
  }

  private wrap(cfg: McpServerConfig, client: McpStdioClient, t: McpToolInfo): Tool<Record<string, unknown>> {
    return {
      name: this.toolName(cfg, t.name),
      description: `[MCP ${cfg.name}] ${t.description}`.slice(0, 1000),
      actionKind: 'mcp.call',
      input: z.record(z.string(), z.unknown()),
      jsonSchema: t.inputSchema,
      paths: () => [],
      run: async (args) => {
        const res = await client.callTool(t.name, args);
        if (res.isError) throw new Error(res.text || 'MCP tool error');
        return res.text;
      },
    };
  }

  private toolName(cfg: McpServerConfig, tool: string) {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    return `mcp_${clean(cfg.name)}_${clean(tool)}`.slice(0, 64);
  }

  private secretAccount(id: string, key: string) {
    return `mcp:${id}:${key}`;
  }

  private async configs(): Promise<McpServerConfig[]> {
    return (await this.settings.get<McpServerConfig[]>(KEY)) ?? [];
  }
}

import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PixelApp } from '../app/pixel';
import { MemoryCredentialStore } from '../security/credentials';
import { McpStdioClient } from './client';

const SERVER = fileURLToPath(new URL('../testing/fake-mcp-server.mjs', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

describe('MCP stdio client', () => {
  it('initializes, lists and calls tools', async () => {
    const c = new McpStdioClient(process.execPath, [SERVER], {});
    cleanup.push(() => c.close());
    await c.connect();
    expect(c.serverInfo.name).toBe('fake');
    expect((await c.listTools()).map((t) => t.name)).toEqual(['echo', 'add']);
    expect(await c.callTool('add', { a: 2, b: 3 })).toEqual({ text: '5', isError: false });
    await expect(c.callTool('nope', {})).rejects.toThrow(/unknown tool/);
  });

  it('reports a failing server clearly', async () => {
    const c = new McpStdioClient('/nonexistent/binary', [], {});
    await expect(c.connect()).rejects.toThrow(/Failed to start|exited/);
  });
});

describe('MCP manager', () => {
  it('registers MCP tools behind governance, injects secrets from the credential store, and unregisters on disconnect', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pixel-mcp-'));
    const app = await PixelApp.open({ dataDir, migrationsFolder: MIGRATIONS, credentials: new MemoryCredentialStore(), latencyScale: 0 });
    cleanup.push(() => app.close());
    const cfg = await app.mcp.add({ name: 'Fake', command: process.execPath, args: [SERVER], env: {}, secretEnvKeys: ['FAKE_TOKEN'], enabled: true });
    await expect(app.mcp.connect(cfg.id)).rejects.toThrow(/FAKE_TOKEN is not set/);
    await app.mcp.setSecret(cfg.id, 'FAKE_TOKEN', 'super-secret-token-value');
    const status = await app.mcp.connect(cfg.id);
    expect(status.connected).toBe(true);
    expect(status.tools.map((t) => t.toolName)).toEqual(['mcp_fake_echo', 'mcp_fake_add']);
    const tool = app.tools.get('mcp_fake_echo')!;
    expect(tool.actionKind).toBe('mcp.call');
    expect(await tool.run({ text: 'hi' }, { root: null })).toBe('echo: hi (token set)');
    expect(JSON.stringify(await app.mcp.list())).not.toContain('super-secret-token-value');
    await app.mcp.disconnect(cfg.id);
    expect(app.tools.get('mcp_fake_echo')).toBeUndefined();
  });
});

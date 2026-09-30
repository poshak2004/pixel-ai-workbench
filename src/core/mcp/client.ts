import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * Minimal Model Context Protocol client over stdio (newline-delimited JSON-RPC 2.0).
 * Supports the tool surface: initialize → tools/list → tools/call.
 */
export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private stderrTail = '';
  serverInfo: { name?: string; version?: string } = {};

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string>,
    private readonly cwd?: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async connect(): Promise<void> {
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: process.env.HOME ?? '', ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (c: string) => (this.stderrTail = (this.stderrTail + c).slice(-2000)));
    const exited = new Promise<never>((_, reject) => {
      this.proc!.once('error', (err) => reject(new Error(`Failed to start MCP server: ${err.message}`)));
      this.proc!.once('exit', (code) => {
        const err = new Error(`MCP server exited (${code ?? 'signal'})${this.stderrTail ? `: ${this.stderrTail.trim().slice(-300)}` : ''}`);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(err);
        }
        this.pending.clear();
        reject(err);
      });
    });
    exited.catch(() => undefined);
    const init = (await Promise.race([
      this.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'PIXEL', version: '0.1.0' } }),
      exited,
    ])) as { serverInfo?: { name?: string; version?: string } };
    this.serverInfo = init?.serverInfo ?? {};
    this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const res = (await this.request('tools/list', cursor ? { cursor } : {})) as { tools?: McpToolInfo[]; nextCursor?: string };
      for (const t of res.tools ?? []) tools.push({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object' } });
      cursor = res.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const res = (await this.request('tools/call', { name, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean };
    const text = (res.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type} content]`)).join('\n');
    return { text, isError: !!res.isError };
  }

  close(): void {
    this.proc?.kill();
    this.proc = null;
  }

  get alive(): boolean {
    return !!this.proc && this.proc.exitCode === null;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error('MCP server not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown) {
    this.proc?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id !== 'number') continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'MCP error'));
      else p.resolve(msg.result);
    }
  }
}

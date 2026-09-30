// A tiny MCP server over stdio used by tests: exposes `echo` and `add`.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } } });
  else if (msg.method === 'tools/list')
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'add', description: 'Add numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
    ] } });
  else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'echo') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo: ${args.text} (${process.env.FAKE_TOKEN ? 'token set' : 'no token'})` }] } });
    else if (name === 'add') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String(args.a + args.b) }] } });
    else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown tool' } });
  } else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
});

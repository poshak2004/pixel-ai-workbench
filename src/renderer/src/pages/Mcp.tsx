import { Plug, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Page } from '../components/layout/Page';
import { Badge, Card, Empty, ErrorNote, PageHeader, SectionTitle, StatusDot } from '../components/ui/display';
import { Dialog } from '../components/ui/overlay';
import { Button, Field, Input } from '../components/ui/primitives';
import { call } from '../lib/ipc';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';

export function McpPage() {
  const servers = useQuery('mcp.list');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const connect = useAction((id: string) => call('mcp.connect', { id }), { onError: (m) => toast('error', m) });
  const disconnect = useAction((id: string) => call('mcp.disconnect', { id }));
  const remove = useAction((id: string) => call('mcp.remove', { id }));
  const [secret, setSecret] = useState<{ id: string; key: string; value: string } | null>(null);
  const saveSecret = useAction(async () => {
    await call('mcp.setSecret', secret!);
    setSecret(null);
    toast('success', 'Secret stored in the Keychain');
  }, { onError: (m) => toast('error', m) });
  return (
    <Page>
      <PageHeader kicker="Model Context Protocol" title="MCP servers" actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={13} /> Add server</Button>}>
        Local stdio MCP servers. Connected servers' tools join PIXEL's tool registry as <code className="font-mono">mcp_&lt;server&gt;_&lt;tool&gt;</code>. Every call goes through the agent's MCP permission and governance. Secret environment values live in the Keychain.
      </PageHeader>
      {servers.data?.length === 0 ? <Empty title="No MCP servers" icon={<Plug size={20} className="text-ink-3" />}>Add a server such as <code className="font-mono">npx -y @modelcontextprotocol/server-filesystem /path</code>.</Empty> : null}
      <div className="flex flex-col gap-4">
        {(servers.data ?? []).map((s) => (
          <Card key={s.config.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2"><StatusDot status={s.connected ? 'done' : 'idle'} /><span className="text-[14px] font-semibold">{s.config.name}</span>{s.serverInfo.name ? <Badge>{s.serverInfo.name} {s.serverInfo.version}</Badge> : null}</div>
                <div className="mt-1 font-mono text-[11px] text-ink-3">{s.config.command} {s.config.args.join(' ')}</div>
              </div>
              <div className="flex gap-2">
                {s.connected ? <Button size="sm" onClick={() => disconnect.run(s.config.id)}>Disconnect</Button> : <Button size="sm" variant="sage" onClick={() => connect.run(s.config.id)} busy={connect.busy}>Connect</Button>}
                <Button size="icon" variant="ghost" onClick={() => remove.run(s.config.id)} aria-label="Remove"><Trash2 size={13} /></Button>
              </div>
            </div>
            {s.config.secretEnvKeys.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {s.config.secretEnvKeys.map((k) => (
                  <button key={k} onClick={() => setSecret({ id: s.config.id, key: k, value: '' })} className="rounded-[4px] border border-line px-2 py-0.5 font-mono text-[11px] hover:border-ink-3">
                    {k}: {s.secretsStored.includes(k) ? <span className="text-sage-ink">stored</span> : <span className="text-verm">not set</span>}
                  </button>
                ))}
              </div>
            ) : null}
            {s.error ? <div className="mt-2"><ErrorNote>{s.error}</ErrorNote></div> : null}
            {s.tools.length ? (
              <div className="mt-3">
                <SectionTitle>{s.tools.length} tools</SectionTitle>
                <div className="grid grid-cols-2 gap-1">
                  {s.tools.map((t) => (
                    <div key={t.toolName} className="truncate text-[12px]"><span className="font-mono">{t.toolName}</span> <span className="text-ink-3">{t.description}</span></div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <AddServer open={open} onClose={() => setOpen(false)} />
      <Dialog open={!!secret} onClose={() => setSecret(null)} title={`Set ${secret?.key}`} footer={<><Button onClick={() => setSecret(null)}>Cancel</Button><Button variant="primary" onClick={() => saveSecret.run()} busy={saveSecret.busy}>Store</Button></>}>
        <Input type="password" autoFocus value={secret?.value ?? ''} onChange={(e) => setSecret(secret ? { ...secret, value: e.target.value } : null)} />
      </Dialog>
    </Page>
  );
}

function AddServer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [secrets, setSecrets] = useState('');
  const add = useAction(async () => {
    const envObj = Object.fromEntries(env.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
    await call('mcp.add', { name, command, args: args.split(' ').filter(Boolean), env: envObj, secretEnvKeys: secrets.split(/[\s,]+/).filter(Boolean), enabled: true });
    onClose();
  });
  return (
    <Dialog open={open} onClose={onClose} title="Add MCP server" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => add.run()} busy={add.busy} disabled={!name || !command}>Add</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" /></Field>
        <Field label="Command"><Input value={command} onChange={(e) => setCommand(e.target.value)} /></Field>
        <Field label="Arguments" hint="Space-separated"><Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /Users/me/project" /></Field>
        <Field label="Environment (non-secret)" hint="KEY=value per line"><Input value={env} onChange={(e) => setEnv(e.target.value)} /></Field>
        <Field label="Secret env var names" hint="Values are set afterwards and stored in the Keychain, e.g. GITHUB_TOKEN"><Input value={secrets} onChange={(e) => setSecrets(e.target.value)} /></Field>
        <ErrorNote>{add.error}</ErrorNote>
      </div>
    </Dialog>
  );
}

import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Page } from '../components/layout/Page';
import { Badge, Card, KV, PageHeader, SectionTitle } from '../components/ui/display';
import { Tabs } from '../components/ui/overlay';
import { Button } from '../components/ui/primitives';
import { call } from '../lib/ipc';
import { useAction, useQuery } from '../lib/store';

export function SettingsPage() {
  const [tab, setTab] = useState<'governance' | 'security' | 'appearance'>('governance');
  return (
    <Page wide>
      <PageHeader kicker="Configuration" title="Settings" />
      <Tabs tabs={[{ id: 'governance', label: 'Governance' }, { id: 'security', label: 'Security & data' }, { id: 'appearance', label: 'Appearance' }]} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'governance' ? <Governance /> : tab === 'security' ? <Security /> : <Appearance />}
    </Page>
  );
}

function Governance() {
  const policies = useQuery('policies.list');
  const tables = useQuery('tables.list');
  const del = useAction((id: string) => call('policies.delete', { id }));
  const addHumanGate = useAction(() => call('policies.save', { id: null, name: 'Require approval for terminal & writes', layer: 'project', scopeType: 'global', scopeId: null, rules: [{ id: `project.approve-${Date.now().toString(36)}`, type: 'require_approval', actions: ['shell.exec', 'fs.write', 'git.write'], description: 'Terminal, file writes and git writes need a human.' }] }));
  const order = ['safety', 'system', 'project', 'table', 'role', 'agent', 'task'];
  const sorted = [...(policies.data ?? [])].sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
  return (
    <div className="grid grid-cols-[1fr_320px] gap-6">
      <div className="flex flex-col gap-4">
        {sorted.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone={p.layer === 'safety' ? 'verm' : p.layer === 'system' ? 'amber' : 'blue'}>{p.layer}</Badge>
                <span className="text-[14px] font-semibold">{p.name}</span>
                {p.locked ? <Lock size={12} className="text-ink-3" aria-label="Locked" /> : null}
                {p.scopeType !== 'global' ? <Badge>{p.scopeType}: {tables.data?.find((t) => t.id === p.scopeId)?.name ?? p.scopeId}</Badge> : null}
              </div>
              {p.locked ? <span className="font-mono text-[10.5px] text-ink-3">enforced from code · not editable by agents or DB</span> : <Button size="sm" variant="danger" onClick={() => del.run(p.id)}>Remove</Button>}
            </div>
            <div className="divide-y divide-line-2">
              {p.rules.map((r) => (
                <div key={r.id} className="grid grid-cols-[220px_170px_1fr] gap-3 py-1.5 text-[12px]">
                  <span className="font-mono text-[11px]">{r.id}</span>
                  <span className="font-mono text-[11px] text-ink-3">{r.type}</span>
                  <span className="text-ink-2">{r.description}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
        <Button className="self-start" onClick={() => addHumanGate.run()} busy={addHumanGate.busy}>+ Add project policy: approve terminal & writes</Button>
      </div>
      <Card className="self-start p-4">
        <SectionTitle>How decisions are made</SectionTitle>
        <ol className="space-y-1 text-[12px] text-ink-2">
          <li>1. Every applicable rule in every layer yields ALLOW, RETRY, REROUTE, WAIT, ESCALATE or BLOCK.</li>
          <li>2. The most restrictive decision wins. Lower layers can only tighten.</li>
          <li>3. Ties are attributed to the higher-precedence layer.</li>
          <li>4. Only a strictly higher layer may waive a rule. Safety rules can never be waived.</li>
          <li>5. Relaxation attempts from lower layers are recorded as violations and ignored.</li>
        </ol>
        <div className="rule-dotted my-3" />
        <p className="text-[11.5px] text-ink-3">Agents recommend; the governor decides. Agents have no tool that can modify governance, constitutions, credentials or permission policies, and those paths are write-protected by the safety layer.</p>
      </Card>
    </div>
  );
}

function Security() {
  const info = useQuery('app.info');
  return (
    <div className="grid grid-cols-2 gap-6">
      <Card className="p-4">
        <SectionTitle>Credentials</SectionTitle>
        <KV k="Storage" v={info.data?.credentialBackend === 'keychain' ? 'macOS Keychain' : 'Process memory (test mode)'} />
        <KV k="In SQLite" v="fingerprint only" />
        <KV k="In renderer" v="never" />
        <p className="mt-2 text-[11.5px] text-ink-3">Keys are sent once from the input field to the main process, stored in the Keychain under the service <code className="font-mono">dev.pixel.workbench</code>, and read back only to construct a provider client. They are registered with the redactor so they never appear in events, logs or errors.</p>
      </Card>
      <Card className="p-4">
        <SectionTitle>Data</SectionTitle>
        <KV k="Data directory" v={info.data?.dataDir ?? '…'} />
        <KV k="Platform" v={`${info.data?.platform ?? ''} ${info.data?.arch ?? ''}`} />
        <KV k="Telemetry" v="none" />
        <p className="mt-2 text-[11.5px] text-ink-3">Everything is local: runs, events, judgments and usage live in SQLite in the data directory. Nothing leaves your Mac except requests to the model providers you configure.</p>
      </Card>
    </div>
  );
}

function Appearance() {
  const [theme, setTheme] = useState(() => localStorage.getItem('pixel.theme') ?? 'system');
  const choose = (t: string) => {
    localStorage.setItem('pixel.theme', t);
    setTheme(t);
    window.dispatchEvent(new Event('pixel-theme'));
  };
  return (
    <Card className="max-w-md p-4">
      <SectionTitle>Theme</SectionTitle>
      <div className="flex gap-2">
        {['system', 'light', 'dark'].map((t) => (
          <Button key={t} variant={theme === t ? 'primary' : 'secondary'} onClick={() => choose(t)}>{t}</Button>
        ))}
      </div>
    </Card>
  );
}

import { KeyRound, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModelSelect } from '../components/agents/ModelSelect';
import { Page } from '../components/layout/Page';
import { CompareReport } from './RunView';
import { Badge, Card, ErrorNote, PageHeader, SectionTitle, StatusDot } from '../components/ui/display';
import { Dialog, Tabs } from '../components/ui/overlay';
import { Button, Field, Input, Select, Textarea, Toggle } from '../components/ui/primitives';
import { fmtAgo, fmtContext } from '../lib/format';
import { call } from '../lib/ipc';
import { refKey, useModelOptions } from '../lib/models';
import { navigate, useRoute } from '../lib/router';
import { useAction, useQuery } from '../lib/store';
import { useToast } from '../lib/toast';
import type { ProviderStatus } from '../lib/types';
import { useRun } from '../lib/useRun';

type Tab = 'providers' | 'models' | 'observatory';

export function ModelsPage() {
  const { path } = useRoute();
  const [tab, setTab] = useState<Tab>(path.includes('tab=observatory') ? 'observatory' : 'providers');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (path.includes('add=1')) setAdding(true);
  }, [path]);
  return (
    <Page wide>
      <PageHeader kicker="Bring your own key" title="Models" actions={<Button variant="primary" onClick={() => setAdding(true)} data-testid="add-provider"><Plus size={13} /> Add provider</Button>}>
        Providers are pluggable. Keys live in the macOS Keychain; PIXEL's database stores only a fingerprint. Models come from each provider's own discovery API.
      </PageHeader>
      <Tabs tabs={[{ id: 'providers', label: 'Providers' }, { id: 'models', label: 'Models' }, { id: 'observatory', label: 'Observatory' }]} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'providers' ? <Providers /> : null}
      {tab === 'models' ? <ModelTable /> : null}
      {tab === 'observatory' ? <Observatory /> : null}
      <AddProvider open={adding} onClose={() => { setAdding(false); if (path.includes('add=1')) navigate('/models'); }} />
    </Page>
  );
}

function Providers() {
  const providers = useQuery('providers.list');
  return (
    <div className="grid grid-cols-2 gap-4">
      {(providers.data ?? []).map((p) => (
        <ProviderCard key={p.config.id} p={p} />
      ))}
    </div>
  );
}

function ProviderCard({ p }: { p: ProviderStatus }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const test = useAction(async () => {
    const r = await call('providers.test', { id: p.config.id });
    toast(r.ok ? 'success' : 'error', `${p.config.name}: ${r.message} (${r.latencyMs}ms)`);
  });
  const discover = useAction(async () => {
    const n = await call('providers.discover', { id: p.config.id });
    toast('success', `${p.config.name}: ${n} models discovered`);
  }, { onError: (m) => toast('error', m) });
  const setSecret = useAction(async () => {
    await call('providers.setSecret', { id: p.config.id, secret: key });
    setKey('');
    setEditingKey(false);
    toast('success', 'Key stored in the Keychain');
  }, { onError: (m) => toast('error', m) });
  const remove = useAction(() => call('providers.remove', { id: p.config.id }));
  const enable = useAction((v: boolean) => call('providers.setEnabled', { id: p.config.id, enabled: v }));
  const isDemo = p.config.kind === 'mock';
  return (
    <Card className="p-4" data-testid={`provider-${p.config.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={p.ready ? 'done' : 'idle'} />
            <span className="text-[14px] font-semibold">{p.config.name}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <Badge>{p.label}</Badge>
            <Badge tone={p.authKind === 'api_key' ? 'blue' : p.authKind === 'subscription' ? 'amber' : 'sage'}>{p.authKind === 'api_key' ? 'API key' : p.authKind === 'subscription' ? 'subscription' : 'no auth'}</Badge>
            {isDemo ? <Badge tone="lav">offline demo</Badge> : null}
            <Badge>{p.modelCount} models</Badge>
          </div>
        </div>
        <Toggle checked={p.config.enabled} onChange={(v) => enable.run(v)} />
      </div>
      {p.config.baseUrl ? <div className="mt-2 truncate font-mono text-[11px] text-ink-3">{p.config.baseUrl}</div> : null}
      {p.authKind === 'api_key' ? (
        <div className="mt-3 rounded-[5px] border border-line bg-card-2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-2">
              <KeyRound size={12} />
              {p.credential.stored ? (
                <>
                  {p.credential.backend === 'keychain' ? 'Keychain' : 'Memory'} · fp {p.credential.fingerprint}
                  {p.credential.lastStatus ? <Badge tone={p.credential.lastStatus === 'ok' ? 'sage' : 'verm'}>{p.credential.lastStatus}</Badge> : null}
                  {p.credential.lastVerifiedAt ? <span className="text-ink-3">{fmtAgo(p.credential.lastVerifiedAt)}</span> : null}
                </>
              ) : (
                <span className="text-verm">no key stored</span>
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditingKey(!editingKey)}>{p.credential.stored ? 'Replace' : 'Add key'}</Button>
          </div>
          {editingKey ? (
            <div className="mt-2 flex gap-2">
              <Input type="password" autoComplete="off" placeholder="Paste API key" value={key} onChange={(e) => setKey(e.target.value)} />
              <Button variant="primary" onClick={() => setSecret.run()} busy={setSecret.busy} disabled={!key}>Store</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => test.run()} busy={test.busy}><Zap size={12} /> Test</Button>
          <Button size="sm" onClick={() => discover.run()} busy={discover.busy}><RefreshCw size={12} /> Discover models</Button>
        </div>
        {isDemo ? null : (
          <Button size="icon" variant="ghost" onClick={() => remove.run()} aria-label="Remove provider"><Trash2 size={13} /></Button>
        )}
      </div>
    </Card>
  );
}

function AddProvider({ open, onClose }: { open: boolean; onClose: () => void }) {
  const kinds = useQuery('providers.kinds', undefined, { enabled: open });
  const toast = useToast();
  const [kind, setKind] = useState<'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'openai_compatible' | 'local'>('anthropic');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secret, setSecret] = useState('');
  const k = kinds.data?.find((x) => x.kind === kind);
  const add = useAction(async () => {
    const { id } = await call('providers.add', { kind, name: name || k?.label || kind, baseUrl: baseUrl || null, secret: secret || undefined });
    setSecret('');
    const t = await call('providers.test', { id });
    if (t.ok) {
      const n = await call('providers.discover', { id });
      toast('success', `Connected — ${n} models discovered`);
    } else toast('error', `Added, but the connection test failed: ${t.message}`);
    onClose();
  }, { onError: (m) => toast('error', m) });
  return (
    <Dialog open={open} onClose={onClose} title="Add provider" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => add.run()} busy={add.busy} disabled={k?.authKind === 'api_key' && !secret}>Add & discover</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Provider">
          <Select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setBaseUrl(''); }}>
            {(kinds.data ?? []).filter((x) => x.kind !== 'mock').map((x) => (
              <option key={x.kind} value={x.kind}>{x.label}</option>
            ))}
          </Select>
        </Field>
        {k ? <p className="text-[12px] text-ink-2">{k.description}</p> : null}
        <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={k?.label} /></Field>
        <Field label="Base URL" hint={k?.defaultBaseUrl ? `Default: ${k.defaultBaseUrl}` : undefined}>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={k?.defaultBaseUrl ?? ''} />
        </Field>
        {k?.authKind === 'api_key' || kind === 'openai_compatible' ? (
          <Field label="API key" hint="Sent once to the main process and stored in the macOS Keychain. Never written to disk by PIXEL, never shown again.">
            <Input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} data-testid="provider-key" />
          </Field>
        ) : (
          <p className="text-[12px] text-ink-3">No key needed — local servers run on this Mac. Start Ollama or LM Studio first.</p>
        )}
        <p className="text-[11.5px] text-ink-3">Consumer subscriptions (sign-in based plans) are distinct from metered API keys; PIXEL currently supports API keys and keyless local servers.</p>
      </div>
    </Dialog>
  );
}

function ModelTable() {
  const models = useQuery('models.list');
  const { providerName } = useModelOptions();
  const toast = useToast();
  const [editing, setEditing] = useState<{ providerId: string; modelId: string; input: string; output: string } | null>(null);
  const savePricing = useAction(async () => {
    await call('models.setPricing', { ref: { providerId: editing!.providerId, modelId: editing!.modelId }, pricing: editing!.input === '' ? null : { inputPerMTok: Number(editing!.input), outputPerMTok: Number(editing!.output) } });
    setEditing(null);
  }, { onError: (m) => toast('error', m) });
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left font-mono text-[10px] tracking-wider text-ink-3 uppercase">
            {['Provider', 'Model', 'Context', 'Capabilities', 'Input $/MTok', 'Output $/MTok', 'Pricing source', ''].map((h, i) => (
              <th key={i} className="border-b border-line px-3 py-2 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(models.data ?? []).map((m) => (
            <tr key={refKey({ providerId: m.providerId, modelId: m.id })} className="border-b border-line-2">
              <td className="px-3 py-1.5 text-ink-2">{providerName(m.providerId)}</td>
              <td className="px-3 py-1.5">
                <div>{m.displayName}</div>
                <div className="font-mono text-[10.5px] text-ink-3">{m.id}</div>
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{fmtContext(m.contextWindow)}</td>
              <td className="px-3 py-1.5">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(m.capabilities).filter(([, v]) => v).map(([k]) => (
                    <Badge key={k}>{k}</Badge>
                  ))}
                </div>
              </td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{m.pricing ? m.pricing.inputPerMTok : '—'}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">{m.pricing ? m.pricing.outputPerMTok : '—'}</td>
              <td className="px-3 py-1.5">{m.pricing ? <Badge tone={m.pricing.source === 'user' ? 'lav' : m.pricing.source === 'provider' ? 'sage' : 'neutral'}>{m.pricing.source}</Badge> : <Badge tone="amber">unknown</Badge>}</td>
              <td className="px-3 py-1.5 text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing({ providerId: m.providerId, modelId: m.id, input: String(m.userPricing?.inputPerMTok ?? ''), output: String(m.userPricing?.outputPerMTok ?? '') })}>Set price</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`Pricing · ${editing?.modelId}`} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={() => savePricing.run()} busy={savePricing.busy}>Save</Button></>}>
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Input $/MTok"><Input type="number" min={0} step="0.01" value={editing.input} onChange={(e) => setEditing({ ...editing, input: e.target.value })} /></Field>
            <Field label="Output $/MTok"><Input type="number" min={0} step="0.01" value={editing.output} onChange={(e) => setEditing({ ...editing, output: e.target.value })} /></Field>
            <p className="col-span-2 text-[11.5px] text-ink-3">Your override wins over catalog pricing. Leave input empty to clear it. Provider-reported costs (e.g. OpenRouter) still take precedence per call.</p>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

function Observatory() {
  const roles = useQuery('roles.list');
  const { options, label } = useModelOptions();
  const toast = useToast();
  const [task, setTask] = useState('Design a retry policy for flaky network calls');
  const [roleId, setRoleId] = useState('role_engineer');
  const [picked, setPicked] = useState<string[]>([]);
  const [reviewer, setReviewer] = useState<{ providerId: string; modelId: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const { detail } = useRun(runId);
  useEffect(() => {
    if (!picked.length && options.length >= 2) setPicked(options.slice(0, 3).map((o) => o.value));
    if (!reviewer && options[0]) setReviewer({ providerId: options[0].providerId, modelId: options[0].modelId });
  }, [options, picked.length, reviewer]);
  const start = useAction(async () => {
    const r = await call('runs.startCompare', { task, roleId, candidates: picked.map((v) => ({ providerId: v.split('::')[0]!, modelId: v.split('::')[1]! })), reviewer });
    setRunId(r.id);
  }, { onError: (m) => toast('error', m) });
  const report = detail?.artifacts.find((a) => a.kind === 'report');
  return (
    <div className="grid grid-cols-[400px_1fr] gap-6">
      <Card className="flex flex-col gap-3 p-4">
        <SectionTitle>Same task, same role, different models</SectionTitle>
        <Field label="Task"><Textarea rows={3} value={task} onChange={(e) => setTask(e.target.value)} /></Field>
        <Field label="Role">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {(roles.data ?? []).filter((r) => r.constitution.authority.canPropose).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Candidates (2–8)">
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-[5px] border border-line p-2">
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={picked.includes(o.value)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))} />
                {o.providerName} · {o.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Blind reviewer (Critic constitution)" hint="Reviews every candidate without seeing which model produced it.">
          <ModelSelect value={reviewer} onChange={setReviewer} />
        </Field>
        <Button variant="primary" onClick={() => start.run()} busy={start.busy} disabled={picked.length < 2}>Run comparison</Button>
        <ErrorNote>{start.error}</ErrorNote>
      </Card>
      <div>
        {report ? <CompareReport content={report.content} label={label} /> : runId ? <Card className="p-6 text-center text-[12.5px] text-ink-3">Running {picked.length} candidates{detail?.run.status ? ` · ${detail.run.status}` : ''}…</Card> : <Card className="p-6 text-[12.5px] text-ink-3">Compare quality signals (blind review verdicts, challenges, evidence), latency, tokens, cost and tool calls side by side. Nothing is collapsed into one score.</Card>}
        {runId ? <Button className="mt-3" size="sm" variant="ghost" onClick={() => navigate(`/runs/${runId}`)}>Open run →</Button> : null}
      </div>
    </div>
  );
}

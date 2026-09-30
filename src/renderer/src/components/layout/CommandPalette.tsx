import { Command } from 'cmdk';
import { useEffect } from 'react';
import { call } from '../../lib/ipc';
import { navigate } from '../../lib/router';
import { invalidate, useQuery } from '../../lib/store';
import { NAV } from './nav';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const tables = useQuery('tables.list', undefined, { enabled: open });
  const runs = useQuery('runs.list', { limit: 12 }, { enabled: open });
  const workflows = useQuery('workflows.list', undefined, { enabled: open });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  const go = (p: string) => {
    onOpenChange(false);
    navigate(p);
  };
  const item = 'flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px] text-ink-2 data-[selected=true]:bg-paper-2 data-[selected=true]:text-ink';
  const group = 'px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:uppercase';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-[14vh]" onMouseDown={() => onOpenChange(false)}>
      <div className="w-[560px] overflow-hidden rounded-[8px] border border-line bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <Command label="Command palette" loop>
          <Command.Input autoFocus placeholder="Jump to a page, table or run…" className="h-11 w-full border-b border-line bg-transparent px-4 text-[13.5px] outline-none placeholder:text-ink-3" />
          <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-[12px] text-ink-3">Nothing matches.</Command.Empty>
            <Command.Group heading="Actions" className={group}>
              <Command.Item className={item} onSelect={() => go('/tables?new=1')}>New table</Command.Item>
              <Command.Item className={item} onSelect={() => go('/models?add=1')}>Add provider / API key</Command.Item>
              <Command.Item className={item} onSelect={() => go('/playground')}>Open playground</Command.Item>
              <Command.Item
                className={item}
                onSelect={async () => {
                  onOpenChange(false);
                  const d = await call('app.createDemo');
                  invalidate(true);
                  navigate(`/tables/${d.tableId}`);
                }}
              >
                Load demo council (no API keys)
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Pages" className={group}>
              {NAV.map((n) => (
                <Command.Item key={n.path} value={`page ${n.label} ${n.hint}`} className={item} onSelect={() => go(n.path)}>
                  <n.icon size={13} className="text-ink-3" /> {n.label}
                  <span className="ml-auto text-[11px] text-ink-3">{n.hint}</span>
                </Command.Item>
              ))}
            </Command.Group>
            {tables.data?.length ? (
              <Command.Group heading="Tables" className={group}>
                {tables.data.map((t) => (
                  <Command.Item key={t.id} value={`table ${t.name} ${t.id}`} className={item} onSelect={() => go(`/tables/${t.id}`)}>
                    {t.name} <span className="ml-auto font-mono text-[10.5px] text-ink-3">{t.seats.length} seats</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {workflows.data?.length ? (
              <Command.Group heading="Workflows" className={group}>
                {workflows.data.map((w) => (
                  <Command.Item key={w.id} value={`workflow ${w.name} ${w.id}`} className={item} onSelect={() => go(`/workflows/${w.id}`)}>
                    {w.name}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {runs.data?.length ? (
              <Command.Group heading="Recent runs" className={group}>
                {runs.data.map((r) => (
                  <Command.Item key={r.id} value={`run ${r.title} ${r.id}`} className={item} onSelect={() => go(`/runs/${r.id}`)}>
                    <span className="truncate">{r.title}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-3">{r.outcome ?? r.status}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

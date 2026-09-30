import { Command } from 'lucide-react';
import { cn } from '../../lib/cn';
import { navigate, useRoute } from '../../lib/router';
import { useQuery } from '../../lib/store';
import { PixelLogo } from '../ui/display';
import { NAV } from './nav';

export function Sidebar({ onCommand }: { onCommand: () => void }) {
  const { path } = useRoute();
  const approvals = useQuery('approvals.pending');
  const info = useQuery('app.info');
  const active = (p: string) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`));
  return (
    <aside className="flex h-full w-[208px] shrink-0 flex-col border-r border-line bg-paper-2">
      <div className="drag-region flex h-[52px] items-end px-4 pb-2">
        <div className="no-drag ml-[62px] flex items-center">
          <PixelLogo />
        </div>
      </div>
      <button onClick={onCommand} className="no-drag mx-3 mt-2 mb-3 flex h-7 items-center justify-between rounded-[5px] border border-line bg-card px-2 text-[12px] text-ink-3 hover:border-ink-3/50" aria-label="Open command palette">
        <span>Search or jump…</span>
        <span className="flex items-center gap-0.5 font-mono text-[10.5px]">
          <Command size={11} />K
        </span>
      </button>
      <nav className="scroll-thin flex-1 overflow-y-auto px-2" aria-label="Main">
        {NAV.map((item) => {
          const Icon = item.icon;
          const pending = item.path === '/runs' ? (approvals.data?.length ?? 0) : 0;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              title={item.hint}
              className={cn(
                'group mb-[1px] flex w-full items-center gap-2.5 rounded-[5px] px-2 py-[6px] text-left text-[12.5px] transition-colors',
                active(item.path) ? 'bg-card text-ink shadow-paper' : 'text-ink-2 hover:bg-card/60 hover:text-ink',
              )}
            >
              <Icon size={14} strokeWidth={1.75} className={active(item.path) ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2'} />
              <span className="flex-1">{item.label}</span>
              {pending ? <span className="rounded-[3px] bg-amber px-1 font-mono text-[10px] font-semibold text-card">{pending}</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-line px-4 py-3 font-mono text-[10px] leading-relaxed text-ink-3">
        <div className="flex items-center justify-between">
          <span>v{info.data?.version ?? '…'}</span>
          <span title="Where API keys are stored">{info.data?.credentialBackend === 'keychain' ? 'KEYCHAIN' : info.data ? 'MEMORY' : ''}</span>
        </div>
        <div>local-first · {info.data?.arch ?? ''}</div>
      </div>
    </aside>
  );
}

import type { PermissionGrant } from '../../lib/types';
import { cn } from '../../lib/cn';

const SCOPES: { key: keyof PermissionGrant; label: string; levels: { v: string; label: string }[] }[] = [
  { key: 'filesystem', label: 'Filesystem', levels: [{ v: 'none', label: 'None' }, { v: 'project_read', label: 'Read' }, { v: 'worktree_write', label: 'Worktree' }, { v: 'project_write', label: 'Project*' }] },
  { key: 'terminal', label: 'Terminal', levels: [{ v: 'denied', label: 'Denied' }, { v: 'approval', label: 'Approval' }, { v: 'allowed', label: 'Allowed' }] },
  { key: 'git', label: 'Git', levels: [{ v: 'none', label: 'None' }, { v: 'read', label: 'Read' }, { v: 'worktree', label: 'Worktree' }, { v: 'full', label: 'Full*' }] },
  { key: 'browser', label: 'Browser', levels: [{ v: 'denied', label: 'Denied' }, { v: 'approval', label: 'Approval' }, { v: 'allowed', label: 'Allowed' }] },
  { key: 'network', label: 'Network', levels: [{ v: 'denied', label: 'Denied' }, { v: 'allowed', label: 'Allowed' }] },
  { key: 'system', label: 'Mac control', levels: [{ v: 'denied', label: 'Denied' }, { v: 'approval', label: 'Approval' }] },
  { key: 'mcp', label: 'MCP', levels: [{ v: 'denied', label: 'Denied' }, { v: 'approval', label: 'Approval' }, { v: 'allowed', label: 'Allowed' }] },
];

/** Segmented control per scope. `*` levels always require human approval per action. */
export function PermissionsEditor({ value, onChange, disabled }: { value: PermissionGrant; onChange: (v: PermissionGrant) => void; disabled?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[5px] border border-line">
      {SCOPES.map((s, i) => (
        <div key={s.key} className={cn('flex items-center justify-between gap-2 px-2.5 py-1.5', i > 0 && 'border-t border-line-2')}>
          <span className="font-mono text-[10.5px] tracking-wider text-ink-2 uppercase">{s.label}</span>
          <div className="flex overflow-hidden rounded-[4px] border border-line" role="radiogroup" aria-label={s.label}>
            {s.levels.map((l) => {
              const active = value[s.key] === l.v;
              const risky = l.v === 'allowed' || l.v.includes('write') || l.v === 'full';
              return (
                <button
                  key={l.v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => onChange({ ...value, [s.key]: l.v } as PermissionGrant)}
                  className={cn('border-l border-line px-2 py-[3px] text-[11px] first:border-l-0', active ? (risky ? 'bg-peach-soft font-medium text-peach-ink' : 'bg-sage-soft font-medium text-sage-ink') : 'bg-card text-ink-3 hover:text-ink')}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

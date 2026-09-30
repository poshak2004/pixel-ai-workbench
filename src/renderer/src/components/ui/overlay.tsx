import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function Dialog({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/20 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className="max-h-[76vh] overflow-hidden rounded-[8px] border border-line bg-card shadow-xl" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-[14px] font-semibold">{title}</div>
          <button className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="scroll-thin max-h-[56vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line bg-card-2 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 420, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className={cn('fixed inset-y-0 right-0 z-30 flex flex-col border-l border-line bg-card shadow-2xl transition-transform duration-200', open ? 'translate-x-0' : 'pointer-events-none translate-x-full')} style={{ width }} aria-hidden={!open}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3 pt-4">
        <div className="min-w-0 truncate text-[14px] font-semibold">{title}</div>
        <button className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink" onClick={onClose} aria-label="Close panel">
          <X size={14} />
        </button>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4">{open ? children : null}</div>
      {footer && open ? <div className="flex justify-end gap-2 border-t border-line bg-card-2 px-4 py-3">{footer}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-line', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12.5px] transition-colors', value === t.id ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink-2')}
        >
          {t.label}
          {t.count !== undefined ? <span className="font-mono text-[10px] text-ink-3">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

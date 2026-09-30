import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from './cn';

type Toast = { id: number; kind: 'info' | 'error' | 'success'; text: string };
const Ctx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto rounded-md border px-3 py-2 text-[12px] shadow-paper',
              t.kind === 'error' && 'border-verm/40 bg-verm-soft text-ink',
              t.kind === 'success' && 'border-sage/50 bg-sage-soft text-ink',
              t.kind === 'info' && 'border-line bg-card text-ink',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

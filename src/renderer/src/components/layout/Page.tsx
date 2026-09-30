import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className={cn('mx-auto px-8 pt-4 pb-12', wide ? 'max-w-[1480px]' : 'max-w-[1180px]', className)}>{children}</div>
    </div>
  );
}

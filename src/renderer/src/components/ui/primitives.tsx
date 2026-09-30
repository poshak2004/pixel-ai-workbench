import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const button = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary: 'border-ink bg-ink text-paper hover:bg-ink/90',
        secondary: 'border-line bg-card text-ink hover:bg-card-2 hover:border-ink-3/50',
        ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-paper-2 hover:text-ink',
        sage: 'border-sage-ink/30 bg-sage-soft text-sage-ink hover:border-sage-ink/60',
        danger: 'border-verm/40 bg-verm-soft text-verm hover:border-verm',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12px]',
        md: 'h-8 px-3 text-[12.5px]',
        lg: 'h-10 px-4 text-[13px]',
        icon: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, busy, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} disabled={disabled || busy} {...props}>
    {busy ? <PixelSpinner /> : null}
    {children}
  </button>
));
Button.displayName = 'Button';

export function PixelSpinner({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex gap-[2px]', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="pixel-blink inline-block h-[5px] w-[5px] bg-current" style={{ animationDelay: `${i * 0.33}s` }} />
      ))}
    </span>
  );
}

const field = 'w-full rounded-[5px] border border-line bg-card px-2.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-blue focus:outline-none disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn(field, 'h-8', className)} {...props} />);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-[72px] resize-y py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(field, 'h-8 appearance-none bg-[length:10px] bg-[right_8px_center] bg-no-repeat pr-6', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238a8377' fill='none' stroke-width='1.5'/%3E%3C/svg%3E\")" }} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3 uppercase">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[12.5px]', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-[16px] w-[28px] rounded-[3px] border transition-colors', checked ? 'border-sage-ink bg-sage' : 'border-line bg-paper-2')}
      >
        <span className={cn('absolute top-[2px] h-[10px] w-[10px] rounded-[2px] bg-card shadow-sm transition-all', checked ? 'left-[14px]' : 'left-[2px]')} />
      </button>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[12.5px]', disabled && 'opacity-50')}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--sage-ink)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

import { parseRefKey, refKey, useModelOptions } from '../../lib/models';
import { Select } from '../ui/primitives';

export function ModelSelect({ value, onChange, className, allowNone }: { value: { providerId: string; modelId: string } | null; onChange: (v: { providerId: string; modelId: string }) => void; className?: string; allowNone?: boolean }) {
  const { options, providers } = useModelOptions();
  const current = value ? refKey(value) : '';
  const known = options.some((o) => o.value === current);
  return (
    <Select className={className} value={current} onChange={(e) => e.target.value && onChange(parseRefKey(e.target.value))} aria-label="Model">
      {allowNone || !value ? <option value="">Select a model…</option> : null}
      {!known && value ? <option value={current}>{value.modelId} (unavailable)</option> : null}
      {providers
        .filter((p) => p.ready)
        .map((p) => (
          <optgroup key={p.config.id} label={`${p.config.name}${p.config.kind === 'mock' ? ' — offline demo' : ''}`}>
            {options
              .filter((o) => o.providerId === p.config.id)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o.model.pricing ? ` · $${o.model.pricing.inputPerMTok}/$${o.model.pricing.outputPerMTok}` : ''}
                </option>
              ))}
          </optgroup>
        ))}
    </Select>
  );
}

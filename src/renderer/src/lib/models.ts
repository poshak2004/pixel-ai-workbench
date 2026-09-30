import { useMemo } from 'react';
import { useQuery } from './store';
import type { StoredModel } from './types';

export interface ModelOption {
  value: string;
  providerId: string;
  modelId: string;
  label: string;
  providerName: string;
  model: StoredModel;
}

export const refKey = (r: { providerId: string; modelId: string }) => `${r.providerId}::${r.modelId}`;
export const parseRefKey = (k: string) => {
  const [providerId, modelId] = k.split('::');
  return { providerId: providerId!, modelId: modelId! };
};

/** Model choices come from provider discovery — never from a hard-coded list. */
export function useModelOptions() {
  const providers = useQuery('providers.list');
  const models = useQuery('models.list');
  return useMemo(() => {
    const byProvider = new Map((providers.data ?? []).map((p) => [p.config.id, p]));
    const options: ModelOption[] = (models.data ?? [])
      .filter((m) => byProvider.get(m.providerId)?.ready)
      .map((m) => ({ value: refKey({ providerId: m.providerId, modelId: m.id }), providerId: m.providerId, modelId: m.id, label: m.displayName, providerName: byProvider.get(m.providerId)?.config.name ?? m.providerId, model: m }));
    const providerName = (id: string) => byProvider.get(id)?.config.name ?? id;
    const label = (r: { providerId: string; modelId: string }) => {
      const o = options.find((x) => x.value === refKey(r));
      return o ? `${o.providerName} · ${o.label}` : `${providerName(r.providerId)} · ${r.modelId}`;
    };
    return { options, providers: providers.data ?? [], providerName, label, loading: providers.loading || models.loading };
  }, [providers.data, models.data, providers.loading, models.loading]);
}

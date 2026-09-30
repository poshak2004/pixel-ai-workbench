import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { call, subscribe, type ApiChannel, type ApiInput, type ApiOutput } from './ipc';

/**
 * Minimal data layer: queries re-fetch whenever the global revision bumps. Mutations and
 * push events from main bump it. IPC is local, so over-fetching is cheaper than cache bugs.
 */
let revision = 0;
const listeners = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | null = null;

export function invalidate(immediate = false) {
  const bump = () => {
    pending = null;
    revision++;
    for (const l of listeners) l();
  };
  if (immediate) return bump();
  if (!pending) pending = setTimeout(bump, 60);
}

function useRevision() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => revision,
  );
}

let pushWired = false;
export function wirePushInvalidation() {
  if (pushWired) return;
  pushWired = true;
  subscribe('run:status', () => invalidate());
  subscribe('approval:changed', () => invalidate());
}

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useQuery<K extends ApiChannel>(channel: K, input?: ApiInput<K>, opts: { enabled?: boolean } = {}): Query<ApiOutput<K>> {
  const rev = useRevision();
  const [state, setState] = useState<{ data?: ApiOutput<K>; error: string | null; loading: boolean }>({ error: null, loading: true });
  const [local, setLocal] = useState(0);
  const key = JSON.stringify(input ?? null);
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (call as (c: K, i?: unknown) => Promise<ApiOutput<K>>)(channel, input)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((err: Error) => alive && setState((s) => ({ ...s, error: err.message, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key, rev, local, enabled]);
  const reload = useCallback(() => setLocal((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/** Wraps a mutation: tracks busy/error and invalidates queries on success. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { onError?: (msg: string) => void } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fnRef.current(...args);
        invalidate(true);
        return r;
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        opts.onError?.(msg);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { run, busy, error, setError };
}

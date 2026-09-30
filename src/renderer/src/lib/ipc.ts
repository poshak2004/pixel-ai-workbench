import type { ApiChannel, ApiInput, ApiOutput } from '../../../main/api';
import type { PushChannel } from '../../../shared/channels';

declare global {
  interface Window {
    pixel: {
      invoke(channel: string, input?: unknown): Promise<unknown>;
      on(channel: PushChannel, listener: (payload: unknown) => void): () => void;
      platform: string;
    };
  }
}

type Args<K extends ApiChannel> = undefined extends ApiInput<K> ? [input?: ApiInput<K>] : [input: ApiInput<K>];

/** Typed call into the main process. Inputs are validated again on the other side. */
export function call<K extends ApiChannel>(channel: K, ...args: Args<K>): Promise<ApiOutput<K>> {
  return window.pixel.invoke(channel, args[0]) as Promise<ApiOutput<K>>;
}

export function subscribe<T>(channel: PushChannel, listener: (payload: T) => void): () => void {
  return window.pixel.on(channel, listener as (p: unknown) => void);
}

export type { ApiChannel, ApiInput, ApiOutput };

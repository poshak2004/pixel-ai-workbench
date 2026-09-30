/** Push channels from main to renderer. Shared by main, preload and renderer. */
export const PUSH_CHANNELS = ['run:event', 'run:status', 'approval:changed'] as const;
export type PushChannel = (typeof PUSH_CHANNELS)[number];

export const INVOKE_CHANNEL = 'pixel:invoke';

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

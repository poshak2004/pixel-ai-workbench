import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { INVOKE_CHANNEL, PUSH_CHANNELS, type Envelope, type PushChannel } from '../shared/channels';

/**
 * The renderer's only door to the system: one validated invoke channel and a fixed set of
 * push channels. No Node, no ipcRenderer, no secrets.
 */
const api = {
  async invoke(channel: string, input?: unknown): Promise<unknown> {
    const res = (await ipcRenderer.invoke(INVOKE_CHANNEL, channel, input)) as Envelope<unknown>;
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  on(channel: PushChannel, listener: (payload: unknown) => void): () => void {
    if (!PUSH_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`);
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('pixel', api);

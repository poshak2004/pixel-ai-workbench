import { z } from 'zod';
import type { Tool } from '../tools/types';

/**
 * Mac computer-use execution port. Reasoning happens in the model; execution happens here, and
 * only after governance returns ALLOW (safety policy requires human approval for every action).
 */
export interface ComputerDriver {
  readonly name: string;
  readonly available: boolean;
  screenshot(signal?: AbortSignal): Promise<{ mimeType: string; base64: string; width: number; height: number }>;
  click(x: number, y: number, signal?: AbortSignal): Promise<void>;
  type(text: string, signal?: AbortSignal): Promise<void>;
  key(combo: string, signal?: AbortSignal): Promise<void>;
  frontmostApp(signal?: AbortSignal): Promise<string>;
}

export class UnconfiguredComputerDriver implements ComputerDriver {
  readonly name = 'none';
  readonly available = false;
  private fail(): never {
    throw new Error('Mac control is not enabled. Grant Accessibility and Screen Recording permission and enable it in Settings.');
  }
  screenshot() {
    return Promise.reject(this.fail());
  }
  click() {
    return Promise.reject(this.fail());
  }
  type() {
    return Promise.reject(this.fail());
  }
  key() {
    return Promise.reject(this.fail());
  }
  frontmostApp() {
    return Promise.reject(this.fail());
  }
}

const Click = z.object({ x: z.number().int().min(0).max(20_000), y: z.number().int().min(0).max(20_000) });
const Text = z.object({ text: z.string().max(5_000) });
const Key = z.object({ combo: z.string().regex(/^(?:(?:cmd|ctrl|alt|shift)\+)*[a-z0-9]+$|^(?:return|tab|escape|space|delete|up|down|left|right)$/i) });
const None = z.object({}).passthrough();

export function computerTools(driver: ComputerDriver): Tool<any>[] {
  const t = <A>(tool: Omit<Tool<A>, 'actionKind' | 'paths'>): Tool<A> => ({ ...tool, actionKind: 'mac.control', paths: () => [] });
  return [
    t<z.infer<typeof None>>({
      name: 'mac_screenshot',
      description: 'Capture the screen.',
      input: None,
      jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async (_a, ctx) => {
        const s = await driver.screenshot(ctx.signal);
        return `screen ${s.width}x${s.height} captured`;
      },
    }),
    t<z.infer<typeof Click>>({
      name: 'mac_click',
      description: 'Click at screen coordinates.',
      input: Click,
      jsonSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false },
      run: async (a, ctx) => {
        await driver.click(a.x, a.y, ctx.signal);
        return 'clicked';
      },
    }),
    t<z.infer<typeof Text>>({
      name: 'mac_type',
      description: 'Type text into the focused application.',
      input: Text,
      jsonSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      run: async (a, ctx) => {
        await driver.type(a.text, ctx.signal);
        return 'typed';
      },
    }),
    t<z.infer<typeof Key>>({
      name: 'mac_key',
      description: 'Press a keyboard shortcut, e.g. "cmd+s".',
      input: Key,
      jsonSchema: { type: 'object', properties: { combo: { type: 'string' } }, required: ['combo'], additionalProperties: false },
      run: async (a, ctx) => {
        await driver.key(a.combo, ctx.signal);
        return 'pressed';
      },
    }),
  ];
}

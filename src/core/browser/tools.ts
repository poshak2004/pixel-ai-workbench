import { z } from 'zod';
import type { Tool } from '../tools/types';

/**
 * Browser execution port. Agents never drive a browser directly: they request tools, governance
 * decides, and a driver (Playwright / MCP browser server) executes. The driver is swappable.
 */
export interface BrowserDriver {
  readonly name: string;
  readonly available: boolean;
  navigate(url: string, signal?: AbortSignal): Promise<{ title: string; url: string }>;
  snapshot(signal?: AbortSignal): Promise<string>;
  click(selector: string, signal?: AbortSignal): Promise<void>;
  type(selector: string, text: string, signal?: AbortSignal): Promise<void>;
  screenshot(signal?: AbortSignal): Promise<{ mimeType: string; base64: string }>;
}

export class UnconfiguredBrowserDriver implements BrowserDriver {
  readonly name = 'none';
  readonly available = false;
  private fail(): never {
    throw new Error('No browser driver is configured. Connect a Playwright or MCP browser server in Settings → MCP.');
  }
  navigate() {
    return Promise.reject(this.fail());
  }
  snapshot() {
    return Promise.reject(this.fail());
  }
  click() {
    return Promise.reject(this.fail());
  }
  type() {
    return Promise.reject(this.fail());
  }
  screenshot() {
    return Promise.reject(this.fail());
  }
}

/** Only http(s) URLs; never file:, javascript:, chrome: etc. */
export function assertBrowsableUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Blocked URL scheme ${u.protocol}`);
  return u.toString();
}

const Url = z.object({ url: z.string().url() });
const Selector = z.object({ selector: z.string().min(1).max(500) });
const TypeArgs = z.object({ selector: z.string().min(1).max(500), text: z.string().max(10_000) });
const None = z.object({}).passthrough();

export function browserTools(driver: BrowserDriver): Tool<any>[] {
  const t = <A>(tool: Omit<Tool<A>, 'actionKind' | 'paths'>): Tool<A> => ({ ...tool, actionKind: 'browser.use', paths: () => [] });
  return [
    t<z.infer<typeof Url>>({
      name: 'browser_navigate',
      description: 'Open a URL in the controlled browser.',
      input: Url,
      jsonSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
      run: async (a, ctx) => JSON.stringify(await driver.navigate(assertBrowsableUrl(a.url), ctx.signal)),
    }),
    t<z.infer<typeof None>>({
      name: 'browser_snapshot',
      description: 'Return an accessibility snapshot of the current page.',
      input: None,
      jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: (_a, ctx) => driver.snapshot(ctx.signal),
    }),
    t<z.infer<typeof Selector>>({
      name: 'browser_click',
      description: 'Click an element by CSS selector.',
      input: Selector,
      jsonSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'], additionalProperties: false },
      run: async (a, ctx) => {
        await driver.click(a.selector, ctx.signal);
        return 'clicked';
      },
    }),
    t<z.infer<typeof TypeArgs>>({
      name: 'browser_type',
      description: 'Type text into an element by CSS selector.',
      input: TypeArgs,
      jsonSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'], additionalProperties: false },
      run: async (a, ctx) => {
        await driver.type(a.selector, a.text, ctx.signal);
        return 'typed';
      },
    }),
    t<z.infer<typeof None>>({
      name: 'browser_screenshot',
      description: 'Capture a screenshot of the current page.',
      input: None,
      jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async (_a, ctx) => {
        const s = await driver.screenshot(ctx.signal);
        return `screenshot captured (${s.mimeType}, ${Math.round((s.base64.length * 3) / 4 / 1024)} KB)`;
      },
    }),
  ];
}

import { anthropicFactory } from './adapters/anthropic';
import { geminiFactory } from './adapters/gemini';
import { mockFactory } from './adapters/mock';
import { localFactory, openaiCompatibleFactory, openaiFactory, openrouterFactory } from './adapters/openai-compatible';
import type { ProviderFactory, ProviderKind } from './types';

/** Provider families PIXEL can talk to. Adding a provider = adding a factory; nothing above changes. */
export class ProviderRegistry {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();

  constructor(factories: ProviderFactory[] = DEFAULT_FACTORIES) {
    for (const f of factories) this.register(f);
  }

  register(factory: ProviderFactory): void {
    this.factories.set(factory.kind, factory);
  }

  get(kind: ProviderKind): ProviderFactory {
    const f = this.factories.get(kind);
    if (!f) throw new Error(`No provider factory registered for ${kind}`);
    return f;
  }

  list(): ProviderFactory[] {
    return [...this.factories.values()];
  }
}

export const DEFAULT_FACTORIES: ProviderFactory[] = [
  anthropicFactory,
  openaiFactory,
  geminiFactory,
  openrouterFactory,
  openaiCompatibleFactory,
  localFactory,
  mockFactory,
];

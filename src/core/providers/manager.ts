import type { ModelResolver } from '../agents/runner';
import { credentialAccount, fingerprintSecret, validateSecretShape, type CredentialStore } from '../security/credentials';
import type { SecretRedactor } from '../security/redaction';
import type { ProvidersRepo, StoredModel } from '../storage/repos/providers';
import type { Clock, IdGenerator } from '../util/runtime';
import type { ProviderRegistry } from './registry';
import type { AuthKind, ModelPricing, ModelRef, ProviderAdapter, ProviderConfig, ProviderDeps, ProviderKind } from './types';

export interface ProviderStatus {
  config: ProviderConfig;
  label: string;
  authKind: AuthKind;
  credential: { stored: boolean; backend: string | null; fingerprint: string | null; lastStatus: string | null; lastVerifiedAt: number | null };
  modelCount: number;
  ready: boolean;
}

export interface AddProviderInput {
  kind: ProviderKind;
  name: string;
  baseUrl?: string | null;
  /** The API key, if the provider needs one. Goes straight to the credential store; never persisted in SQLite. */
  secret?: string;
  options?: Record<string, unknown>;
}

/**
 * BYOK provider management and model resolution. The only component that ever reads a secret,
 * and only to construct an adapter in the main process.
 */
export class ProviderManager implements ModelResolver {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(
    private readonly repo: ProvidersRepo,
    private readonly registry: ProviderRegistry,
    private readonly credentials: CredentialStore,
    private readonly redactor: SecretRedactor,
    private readonly deps: ProviderDeps,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  kinds() {
    return this.registry.list().map((f) => ({ kind: f.kind, label: f.label, authKind: f.authKind, defaultBaseUrl: f.defaultBaseUrl ?? null, description: f.description }));
  }

  async list(): Promise<ProviderStatus[]> {
    const configs = await this.repo.list();
    const models = await this.repo.listModels();
    return Promise.all(
      configs.map(async (config) => {
        const factory = this.registry.get(config.kind);
        const cred = await this.repo.getCredential(config.id);
        const needsKey = config.authKind === 'api_key';
        return {
          config,
          label: factory.label,
          authKind: config.authKind,
          credential: { stored: !!cred, backend: cred?.backend ?? null, fingerprint: cred?.fingerprint ?? null, lastStatus: cred?.lastStatus ?? null, lastVerifiedAt: cred?.lastVerifiedAt ?? null },
          modelCount: models.filter((m) => m.providerId === config.id).length,
          ready: config.enabled && (!needsKey || !!cred) && config.authKind !== 'subscription',
        };
      }),
    );
  }

  async add(input: AddProviderInput): Promise<ProviderConfig> {
    const factory = this.registry.get(input.kind);
    const config: ProviderConfig = {
      id: this.ids.next('prov'),
      kind: input.kind,
      name: input.name.trim() || factory.label,
      baseUrl: input.baseUrl?.trim() || null,
      authKind: factory.authKind === 'none' && input.secret ? 'api_key' : factory.authKind,
      enabled: true,
      options: input.options ?? {},
      createdAt: this.clock.now(),
    };
    if (config.baseUrl) assertSafeBaseUrl(config.baseUrl, config.kind);
    await this.repo.upsert(config);
    if (input.secret) await this.setSecret(config.id, input.secret);
    return config;
  }

  async remove(providerId: string): Promise<void> {
    this.adapters.delete(providerId);
    await this.credentials.delete(credentialAccount(providerId));
    await this.repo.delete(providerId);
  }

  async setEnabled(providerId: string, enabled: boolean): Promise<void> {
    const c = await this.requireConfig(providerId);
    await this.repo.upsert({ ...c, enabled });
    this.adapters.delete(providerId);
  }

  async setSecret(providerId: string, secret: string): Promise<void> {
    const trimmed = secret.trim();
    const problem = validateSecretShape(trimmed);
    if (problem) throw new Error(problem);
    const config = await this.requireConfig(providerId);
    const account = credentialAccount(providerId);
    await this.credentials.set(account, trimmed);
    this.redactor.register(trimmed);
    await this.repo.setCredential({ providerId, backend: this.credentials.backend, account, fingerprint: fingerprintSecret(trimmed), createdAt: this.clock.now(), lastVerifiedAt: null, lastStatus: null });
    if (config.authKind === 'none') await this.repo.upsert({ ...config, authKind: 'api_key' });
    this.adapters.delete(providerId);
  }

  async clearSecret(providerId: string): Promise<void> {
    await this.credentials.delete(credentialAccount(providerId));
    await this.repo.deleteCredential(providerId);
    this.adapters.delete(providerId);
  }

  async test(providerId: string) {
    let result;
    try {
      const adapter = await this.adapterFor(providerId);
      result = await adapter.testConnection();
    } catch (err) {
      result = { ok: false, message: this.redactor.redactString((err as Error).message), latencyMs: 0 };
    }
    if (await this.repo.getCredential(providerId)) {
      await this.repo.markCredentialStatus(providerId, result.ok ? 'ok' : 'failed', this.clock.now());
    }
    return { ...result, message: this.redactor.redactString(result.message) };
  }

  /** Discover models from the provider itself; the model selector consumes only this. */
  async discover(providerId: string): Promise<StoredModel[]> {
    const adapter = await this.adapterFor(providerId);
    const list = await adapter.listModels();
    await this.repo.replaceModels(providerId, list, this.clock.now());
    return this.repo.listModels(providerId);
  }

  async models(providerId?: string): Promise<StoredModel[]> {
    return this.repo.listModels(providerId);
  }

  async setUserPricing(ref: ModelRef, pricing: Omit<ModelPricing, 'source'> | null) {
    await this.repo.setUserPricing(ref.providerId, ref.modelId, pricing ? { ...pricing, source: 'user' } : null);
  }

  // ── ModelResolver ──
  async adapterFor(providerId: string): Promise<ProviderAdapter> {
    const cached = this.adapters.get(providerId);
    if (cached) return cached;
    const config = await this.requireConfig(providerId);
    if (!config.enabled) throw new Error(`Provider ${config.name} is disabled`);
    if (config.authKind === 'subscription') throw new Error(`${config.name} uses subscription sign-in, which PIXEL does not support yet. Add an API key instead.`);
    const secret = config.authKind === 'api_key' ? await this.credentials.get(credentialAccount(providerId)) : undefined;
    if (config.authKind === 'api_key' && !secret) throw new Error(`No API key stored for ${config.name}`);
    this.redactor.register(secret);
    const adapter = this.registry.get(config.kind).create(config, secret, this.deps);
    this.adapters.set(providerId, adapter);
    return adapter;
  }

  async modelInfo(ref: ModelRef) {
    return this.repo.getModel(ref.providerId, ref.modelId);
  }

  async providerKind(providerId: string): Promise<ProviderKind> {
    return (await this.requireConfig(providerId)).kind;
  }

  private async requireConfig(id: string): Promise<ProviderConfig> {
    const c = await this.repo.get(id);
    if (!c) throw new Error(`Unknown provider ${id}`);
    return c;
  }
}

/** Remote providers must use HTTPS; plain HTTP is only allowed to loopback (local model servers). */
export function assertSafeBaseUrl(url: string, kind: ProviderKind): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid base URL: ${url}`);
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && (loopback || kind === 'local')) return;
  throw new Error('Base URL must use https:// (http:// is allowed only for localhost model servers)');
}

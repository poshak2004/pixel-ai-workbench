import { and, eq } from 'drizzle-orm';
import type { ModelInfo, ModelPricing, ProviderConfig, ProviderKind, AuthKind } from '../../providers/types';
import type { PixelDb } from '../db';
import { credentialsMetadata, models, providers } from '../schema';

export interface CredentialMeta {
  providerId: string;
  backend: string;
  account: string;
  fingerprint: string;
  createdAt: number;
  lastVerifiedAt: number | null;
  lastStatus: string | null;
}

export interface StoredModel extends ModelInfo {
  userPricing: ModelPricing | null;
  discoveredAt: number;
}

export class ProvidersRepo {
  constructor(private readonly db: PixelDb) {}

  async list(): Promise<ProviderConfig[]> {
    const rows = await this.db.select().from(providers).orderBy(providers.createdAt);
    return rows.map(toConfig);
  }

  async get(id: string): Promise<ProviderConfig | null> {
    const [row] = await this.db.select().from(providers).where(eq(providers.id, id));
    return row ? toConfig(row) : null;
  }

  async upsert(c: ProviderConfig): Promise<void> {
    const values = { id: c.id, kind: c.kind, name: c.name, baseUrl: c.baseUrl ?? null, authKind: c.authKind, enabled: c.enabled, options: c.options, createdAt: c.createdAt };
    await this.db.insert(providers).values(values).onConflictDoUpdate({ target: providers.id, set: values });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(providers).where(eq(providers.id, id));
  }

  async setCredential(meta: CredentialMeta): Promise<void> {
    const values = { id: `cred_${meta.providerId}`, ...meta };
    await this.db.insert(credentialsMetadata).values(values).onConflictDoUpdate({ target: credentialsMetadata.providerId, set: values });
  }

  async getCredential(providerId: string): Promise<CredentialMeta | null> {
    const [row] = await this.db.select().from(credentialsMetadata).where(eq(credentialsMetadata.providerId, providerId));
    if (!row) return null;
    const { id: _id, ...rest } = row;
    return rest;
  }

  async deleteCredential(providerId: string): Promise<void> {
    await this.db.delete(credentialsMetadata).where(eq(credentialsMetadata.providerId, providerId));
  }

  async markCredentialStatus(providerId: string, status: string, at: number): Promise<void> {
    await this.db.update(credentialsMetadata).set({ lastStatus: status, lastVerifiedAt: at }).where(eq(credentialsMetadata.providerId, providerId));
  }

  /** Replace the discovered model set for a provider, preserving user pricing overrides. */
  async replaceModels(providerId: string, list: ModelInfo[], at: number): Promise<void> {
    const existing = await this.listModels(providerId);
    const overrides = new Map(existing.map((m) => [m.id, m.userPricing]));
    await this.db.delete(models).where(eq(models.providerId, providerId));
    if (!list.length) return;
    await this.db.insert(models).values(
      list.map((m) => ({
        providerId,
        modelId: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow ?? null,
        maxOutputTokens: m.maxOutputTokens ?? null,
        capabilities: m.capabilities,
        pricing: m.pricing,
        userPricing: overrides.get(m.id) ?? null,
        discoveredAt: at,
      })),
    );
  }

  async listModels(providerId?: string): Promise<StoredModel[]> {
    const rows = providerId ? await this.db.select().from(models).where(eq(models.providerId, providerId)) : await this.db.select().from(models);
    return rows.map(toModel);
  }

  async getModel(providerId: string, modelId: string): Promise<StoredModel | null> {
    const [row] = await this.db.select().from(models).where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)));
    return row ? toModel(row) : null;
  }

  async setUserPricing(providerId: string, modelId: string, pricing: ModelPricing | null): Promise<void> {
    await this.db.update(models).set({ userPricing: pricing }).where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)));
  }
}

function toConfig(row: typeof providers.$inferSelect): ProviderConfig {
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    name: row.name,
    baseUrl: row.baseUrl,
    authKind: row.authKind as AuthKind,
    enabled: row.enabled,
    options: row.options ?? {},
    createdAt: row.createdAt,
  };
}

function toModel(row: typeof models.$inferSelect): StoredModel {
  return {
    id: row.modelId,
    providerId: row.providerId,
    displayName: row.displayName,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    capabilities: row.capabilities,
    // User overrides win over catalog/provider pricing.
    pricing: row.userPricing ?? row.pricing ?? null,
    userPricing: row.userPricing ?? null,
    discoveredAt: row.discoveredAt,
  };
}

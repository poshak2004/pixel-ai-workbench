import { sha256 } from '../util/runtime';

/**
 * Secret storage. Only the main process ever holds a secret, and only transiently while
 * constructing a provider adapter. SQLite stores metadata (fingerprint, timestamps) — never values.
 */
export interface CredentialStore {
  readonly backend: 'keychain' | 'memory';
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | undefined>;
  delete(account: string): Promise<boolean>;
}

export const KEYCHAIN_SERVICE = 'dev.pixel.workbench';

/** macOS Keychain (via the OS credential vault; also Windows Credential Manager / libsecret when ported). */
export class KeychainCredentialStore implements CredentialStore {
  readonly backend = 'keychain' as const;

  constructor(private readonly service = KEYCHAIN_SERVICE) {}

  private async entry(account: string) {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(this.service, account);
  }

  async set(account: string, secret: string) {
    (await this.entry(account)).setPassword(secret);
  }

  async get(account: string) {
    try {
      return (await this.entry(account)).getPassword() ?? undefined;
    } catch {
      return undefined;
    }
  }

  async delete(account: string) {
    try {
      return (await this.entry(account)).deletePassword();
    } catch {
      return false;
    }
  }
}

/** Process-memory store for tests and ephemeral demo sessions. Never persisted. */
export class MemoryCredentialStore implements CredentialStore {
  readonly backend = 'memory' as const;
  private readonly secrets = new Map<string, string>();

  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
  async get(account: string) {
    return this.secrets.get(account);
  }
  async delete(account: string) {
    return this.secrets.delete(account);
  }
}

/** Account name under which a provider's key is stored. */
export function credentialAccount(providerId: string): string {
  return `provider:${providerId}`;
}

/**
 * Non-reversible fingerprint shown in the UI so users can tell keys apart without exposing them.
 * 8 hex chars of a SHA-256 over a high-entropy key reveals nothing useful.
 */
export function fingerprintSecret(secret: string): string {
  return sha256(`pixel:${secret}`).slice(0, 8);
}

export function validateSecretShape(secret: string): string | null {
  const trimmed = secret.trim();
  if (trimmed.length < 8) return 'Key looks too short';
  if (/\s/.test(trimmed)) return 'Key must not contain whitespace';
  if (trimmed.length > 4096) return 'Key is too long';
  return null;
}

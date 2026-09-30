import { cleanText } from '../util/runtime';

/**
 * Secret redaction applied to everything that is persisted, logged or sent to the renderer.
 * Two layers: known credential shapes (pattern-based) and exact values of secrets PIXEL has loaded.
 */

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /sk-or-v1-[A-Za-z0-9]{16,}/g, // OpenRouter
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, // OpenAI-style
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /gh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /(?<=\b(?:Bearer|bearer)\s)[A-Za-z0-9._~+/=-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const SENSITIVE_KEYS = /^(api[_-]?key|apikey|secret|password|passwd|token|access[_-]?token|refresh[_-]?token|authorization|x-api-key|x-goog-api-key|client[_-]?secret)$/i;

export const REDACTED = '[REDACTED]';

export class SecretRedactor {
  private readonly known = new Set<string>();

  /** Register an exact secret value (e.g. after loading it from the Keychain). */
  register(secret: string | undefined | null): void {
    if (secret && secret.length >= 8) this.known.add(secret);
  }

  forget(secret: string): void {
    this.known.delete(secret);
  }

  redactString(input: string): string {
    let out = cleanText(input);
    for (const secret of this.known) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
    return out;
  }

  /** Deep-redact any JSON-like value. Values under sensitive keys are always replaced. */
  redact<T>(value: T): T {
    return this.walk(value, 0) as T;
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 32) return '[TRUNCATED]';
    if (typeof value === 'string') return this.redactString(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.test(k) && v != null && v !== '' ? REDACTED : this.walk(v, depth + 1);
      }
      return out;
    }
    return value;
  }
}

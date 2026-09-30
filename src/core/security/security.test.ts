import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseRelative, readFileTool, resolveInside, writeFileTool } from '../tools/fs';
import { credentialAccount, fingerprintSecret, MemoryCredentialStore, validateSecretShape } from './credentials';
import { checkPermission, DEFAULT_GRANT, intersectGrants, type PermissionGrant } from './permissions';
import { REDACTED, SecretRedactor } from './redaction';
import { ACTION_KINDS } from '../roles/types';

describe('secret redaction', () => {
  const r = new SecretRedactor();
  it.each([
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz0123'],
    ['sk-or-v1-0123456789abcdef0123456789abcdef'],
    ['AIzaSyA1234567890abcdefghijklmnopqrstu'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['AKIAABCDEFGHIJKLMNOP'],
  ])('redacts %s', (secret) => {
    expect(r.redactString(`key=${secret} trailing`)).toBe(`key=${REDACTED} trailing`);
  });

  it('redacts bearer tokens and PEM blocks', () => {
    expect(r.redactString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(r.redactString('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----')).toBe(REDACTED);
  });

  it('redacts exact registered secrets of any shape', () => {
    const r2 = new SecretRedactor();
    r2.register('custom-local-token-42');
    expect(r2.redactString('token custom-local-token-42 used')).toBe(`token ${REDACTED} used`);
  });

  it('deep-redacts objects and sensitive keys', () => {
    const out = new SecretRedactor().redact({ apiKey: 'whatever', nested: { authorization: 'x', note: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }, list: ['ok'], tokens: 5, inputTokens: 5 });
    expect(out).toEqual({ apiKey: REDACTED, nested: { authorization: REDACTED, note: REDACTED }, list: ['ok'], tokens: 5, inputTokens: 5 });
  });

  it('leaves ordinary text alone', () => {
    expect(new SecretRedactor().redactString('The sky is blue; sketch the design.')).toBe('The sky is blue; sketch the design.');
  });
});

describe('credentials', () => {
  it('memory store round-trips and deletes', async () => {
    const s = new MemoryCredentialStore();
    await s.set(credentialAccount('p1'), 'sk-secret-value');
    expect(await s.get('provider:p1')).toBe('sk-secret-value');
    expect(await s.delete('provider:p1')).toBe(true);
    expect(await s.get('provider:p1')).toBeUndefined();
  });

  it('fingerprints are stable, short and do not contain the secret', () => {
    const fp = fingerprintSecret('sk-ant-api03-secret');
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintSecret('sk-ant-api03-secret')).toBe(fp);
    expect(fingerprintSecret('sk-ant-api03-other')).not.toBe(fp);
  });

  it('validates key shape', () => {
    expect(validateSecretShape('short')).toMatch(/short/);
    expect(validateSecretShape('has space in it')).toMatch(/whitespace/);
    expect(validateSecretShape('sk-abcdefghijklmnop')).toBeNull();
  });
});

describe('permissions', () => {
  it('default grant is narrow: read the project, nothing else sensitive', () => {
    expect(checkPermission(DEFAULT_GRANT, 'fs.read').outcome).toBe('allowed');
    for (const a of ['fs.write', 'shell.exec', 'browser.use', 'network.request', 'mac.control', 'mcp.call', 'git.write'] as const) {
      expect(checkPermission(DEFAULT_GRANT, a).outcome, a).toBe('denied');
    }
  });

  it('every action kind has a decision under every grant (total function)', () => {
    const grants: PermissionGrant[] = [DEFAULT_GRANT, { filesystem: 'project_write', terminal: 'allowed', git: 'full', browser: 'allowed', network: 'allowed', system: 'approval', mcp: 'allowed' }];
    for (const g of grants) for (const a of ACTION_KINDS) expect(['allowed', 'approval', 'denied']).toContain(checkPermission(g, a).outcome);
  });

  it('writing to the user checkout needs approval; worktree writes do not', () => {
    expect(checkPermission({ ...DEFAULT_GRANT, filesystem: 'project_write' }, 'fs.write').outcome).toBe('approval');
    expect(checkPermission({ ...DEFAULT_GRANT, filesystem: 'worktree_write' }, 'fs.write').outcome).toBe('allowed');
    expect(checkPermission({ ...DEFAULT_GRANT, git: 'full' }, 'git.write').outcome).toBe('approval');
  });

  it('mac control is never silently allowed', () => {
    expect(checkPermission({ ...DEFAULT_GRANT, system: 'approval' }, 'mac.control').outcome).toBe('approval');
  });

  it('intersection takes the narrower scope', () => {
    const wide: PermissionGrant = { filesystem: 'project_write', terminal: 'allowed', git: 'full', browser: 'allowed', network: 'allowed', system: 'approval', mcp: 'allowed' };
    expect(intersectGrants(wide, DEFAULT_GRANT)).toEqual(DEFAULT_GRANT);
    expect(intersectGrants(wide, { ...DEFAULT_GRANT, terminal: 'approval' }).terminal).toBe('approval');
  });
});

describe('filesystem sandbox', () => {
  it.each(['../etc/passwd', '/etc/passwd', 'a/../../b'])('rejects escaping path %s', (p) => {
    expect(() => normaliseRelative(p)).toThrow(/escapes/);
  });

  it('normalises benign paths', () => {
    expect(normaliseRelative('./src/../README.md')).toBe('README.md');
    expect(normaliseRelative('.')).toBe('.');
  });

  it('blocks symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pixel-fs-'));
    const outside = await mkdtemp(join(tmpdir(), 'pixel-out-'));
    await writeFile(join(outside, 'secret.txt'), 'nope');
    await symlink(outside, join(root, 'link'));
    await expect(resolveInside(root, 'link/secret.txt')).rejects.toThrow(/escapes/);
    await expect(readFileTool.run({ path: 'link/secret.txt' }, { root })).rejects.toThrow(/escapes/);
    await expect(writeFileTool.run({ path: 'link/new.txt', content: 'x' }, { root })).rejects.toThrow(/escapes/);
  });

  it('reads and writes inside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pixel-fs-'));
    await mkdir(join(root, 'src'));
    await writeFileTool.run({ path: 'src/new/file.txt', content: 'hello' }, { root });
    expect(await readFileTool.run({ path: 'src/new/file.txt' }, { root })).toBe('hello');
  });
});

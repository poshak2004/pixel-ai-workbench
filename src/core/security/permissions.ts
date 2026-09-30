import { z } from 'zod';
import type { ActionKind } from '../roles/types';

/**
 * Explicit, per-agent environment permissions. The default grant is deliberately narrow:
 * agents never get unrestricted machine access unless a human widens it.
 */
export const PermissionGrantSchema = z.object({
  filesystem: z.enum(['none', 'project_read', 'worktree_write', 'project_write']),
  terminal: z.enum(['denied', 'approval', 'allowed']),
  git: z.enum(['none', 'read', 'worktree', 'full']),
  browser: z.enum(['denied', 'approval', 'allowed']),
  network: z.enum(['denied', 'allowed']),
  system: z.enum(['denied', 'approval']),
  mcp: z.enum(['denied', 'approval', 'allowed']),
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

export const DEFAULT_GRANT: PermissionGrant = {
  filesystem: 'project_read',
  terminal: 'denied',
  git: 'read',
  browser: 'denied',
  network: 'denied',
  system: 'denied',
  mcp: 'denied',
};

export type PermissionOutcome = 'allowed' | 'approval' | 'denied';

export interface PermissionCheck {
  outcome: PermissionOutcome;
  reason: string;
}

/** Map an attempted action onto the grant. Pure and total: every ActionKind has an answer. */
export function checkPermission(grant: PermissionGrant, action: ActionKind): PermissionCheck {
  switch (action) {
    case 'fs.read':
      return grant.filesystem === 'none'
        ? { outcome: 'denied', reason: 'Filesystem access not granted' }
        : { outcome: 'allowed', reason: `Filesystem: ${grant.filesystem}` };
    case 'fs.write':
      return grant.filesystem === 'worktree_write' || grant.filesystem === 'project_write'
        ? { outcome: grant.filesystem === 'project_write' ? 'approval' : 'allowed', reason: `Filesystem: ${grant.filesystem}` }
        : { outcome: 'denied', reason: 'Write access not granted' };
    case 'shell.exec':
      return fromTri(grant.terminal, 'Terminal');
    case 'git.read':
      return grant.git === 'none' ? { outcome: 'denied', reason: 'Git access not granted' } : { outcome: 'allowed', reason: `Git: ${grant.git}` };
    case 'git.write':
      if (grant.git === 'worktree') return { outcome: 'allowed', reason: 'Git: isolated worktree only' };
      if (grant.git === 'full') return { outcome: 'approval', reason: 'Git: full access requires approval' };
      return { outcome: 'denied', reason: 'Git write access not granted' };
    case 'browser.use':
      return fromTri(grant.browser, 'Browser');
    case 'network.request':
      return grant.network === 'allowed' ? { outcome: 'allowed', reason: 'Network allowed' } : { outcome: 'denied', reason: 'Network access not granted' };
    case 'mac.control':
      return grant.system === 'approval'
        ? { outcome: 'approval', reason: 'System control requires approval for every action' }
        : { outcome: 'denied', reason: 'System control denied' };
    case 'mcp.call':
      return fromTri(grant.mcp, 'MCP');
  }
}

function fromTri(v: 'denied' | 'approval' | 'allowed', label: string): PermissionCheck {
  if (v === 'allowed') return { outcome: 'allowed', reason: `${label} allowed` };
  if (v === 'approval') return { outcome: 'approval', reason: `${label} requires approval` };
  return { outcome: 'denied', reason: `${label} denied` };
}

/** Combine two grants taking the narrower level of each scope (used for role ∩ agent ∩ project). */
export function intersectGrants(a: PermissionGrant, b: PermissionGrant): PermissionGrant {
  const pick = <K extends keyof PermissionGrant>(key: K, order: PermissionGrant[K][]) =>
    order[Math.min(order.indexOf(a[key]), order.indexOf(b[key]))] as PermissionGrant[K];
  return {
    filesystem: pick('filesystem', ['none', 'project_read', 'worktree_write', 'project_write']),
    terminal: pick('terminal', ['denied', 'approval', 'allowed']),
    git: pick('git', ['none', 'read', 'worktree', 'full']),
    browser: pick('browser', ['denied', 'approval', 'allowed']),
    network: pick('network', ['denied', 'allowed']),
    system: pick('system', ['denied', 'approval']),
    mcp: pick('mcp', ['denied', 'approval', 'allowed']),
  };
}

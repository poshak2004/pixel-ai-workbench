import type { Policy } from './types';

/**
 * Built-in policies. Safety and System are locked: not editable from the UI, not writable by agents,
 * and safety rules cannot be waived by any layer.
 */
export const SAFETY_POLICY: Policy = {
  id: 'policy_safety',
  name: 'Safety',
  layer: 'safety',
  locked: true,
  rules: [
    { id: 'safety.permissions', type: 'enforce_permissions', description: 'Tools run only within the agent’s explicit environment permissions.' },
    { id: 'safety.constitution', type: 'enforce_constitution', description: 'Actions must be allowed by the seat’s role constitution; constitutions cannot be altered mid-run.' },
    {
      id: 'safety.protected-paths',
      type: 'protect_paths',
      description: 'Governance, credentials and VCS internals are never writable by agents.',
      actions: ['fs.write', 'shell.exec', 'git.write'],
      patterns: ['**/.git/**', '**/.pixel/**', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/.ssh/**', '**/Library/Keychains/**'],
    },
    {
      id: 'safety.secret-files',
      type: 'protect_paths',
      description: 'Secret-bearing files are never read into model context, directly or through a program.',
      actions: ['fs.read', 'shell.exec'],
      patterns: ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/.ssh/**', '**/.npmrc', '**/.netrc', '**/credentials*.json'],
    },
    { id: 'safety.mac-control', type: 'require_approval', description: 'Every system-control action requires human approval.', actions: ['mac.control'] },
  ],
};

export const SYSTEM_POLICY: Policy = {
  id: 'policy_system',
  name: 'System',
  layer: 'system',
  locked: true,
  rules: [
    { id: 'system.output-retry', type: 'output_retry', maxAttempts: 2, description: 'Malformed agent output is retried once, then escalated.' },
    { id: 'system.veto', type: 'block_on_unresolved', description: 'Unresolved, evidenced challenges from seats with veto authority block execution.' },
    { id: 'system.no-self-judgment', type: 'no_self_judgment', description: 'No seat may judge its own work.' },
    { id: 'system.judge-decides', type: 'judge_must_approve', description: 'Execution requires an explicit judge approval.' },
    { id: 'system.judge-evidence', type: 'require_judge_evidence', min: 1, description: 'Judge decisions must cite evidence.' },
    { id: 'system.judge-confidence', type: 'min_judge_confidence', threshold: 0.5, below: 'ESCALATE', description: 'Low-confidence judgments escalate to a human.' },
  ],
};

export function projectPolicy(projectId: string, opts: { maxCostUsd: number }): Policy {
  return {
    id: `policy_project_${projectId}`,
    name: 'Project',
    layer: 'project',
    locked: false,
    rules: [{ id: `project.${projectId}.budget`, type: 'budget', maxCostUsd: opts.maxCostUsd, description: `Run budget capped at $${opts.maxCostUsd.toFixed(2)}.` }],
  };
}

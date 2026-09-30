import type { Policy, Rule } from '../governance/types';
import type { Table } from './types';

/** The table's constitution as a governance layer: explicit rules plus rules implied by its protocol. */
export function tablePolicy(table: Pick<Table, 'id' | 'protocol' | 'rules'>): Policy {
  const implied: Rule[] = [];
  const p = table.protocol;
  if (p.requireCrossProviderReview) {
    implied.push({ id: `table.${table.id}.cross-provider`, type: 'require_cross_provider_review', description: 'The selected proposal must be reviewed by a seat on a different provider.' });
  }
  if (p.evaluation === 'weighted_authority') {
    implied.push({ id: `table.${table.id}.weighted`, type: 'min_approval_weight', threshold: p.approvalThreshold, description: `Weighted reviewer approval must reach ${Math.round(p.approvalThreshold * 100)}%.` });
  }
  if (p.evaluation === 'consensus') {
    implied.push({ id: `table.${table.id}.consensus`, type: 'min_approval_weight', threshold: 1, description: 'Every non-abstaining reviewer must approve.' });
  }
  if (p.evaluation === 'human_approval') {
    implied.push({ id: `table.${table.id}.human`, type: 'human_approval', description: 'A human must approve the final decision.' });
  }
  return { id: `policy_table_${table.id}`, name: 'Table constitution', layer: 'table', locked: false, rules: [...implied, ...table.rules] };
}

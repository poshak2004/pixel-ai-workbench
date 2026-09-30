import type { Authority, Role } from '../roles/types';
import type { Seat, Table } from './types';

/**
 * Effective authority = role authority, optionally narrowed by the seat.
 * A seat can adjust its weight but can never grant itself powers its role lacks.
 */
export function effectiveAuthority(role: Role, seat: Seat): Authority {
  const base = role.constitution.authority;
  const o = seat.authority ?? {};
  const blockOrder = ['none', 'critical', 'major'] as const; // increasing veto power
  const blockAt = o.blockAt && blockOrder.indexOf(o.blockAt) < blockOrder.indexOf(base.blockAt) ? o.blockAt : base.blockAt;
  return {
    canPropose: base.canPropose && (o.canPropose ?? true),
    canCritique: base.canCritique && (o.canCritique ?? true),
    canJudge: base.canJudge && (o.canJudge ?? true),
    blockAt,
    weight: o.weight ?? base.weight,
  };
}

export interface TableValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateTable(table: Pick<Table, 'seats' | 'protocol'>, roles: Map<string, Role>): TableValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  let proposers = 0;
  let judges = 0;
  let reviewers = 0;

  for (const seat of table.seats) {
    if (ids.has(seat.id)) errors.push(`Duplicate seat id ${seat.id}`);
    ids.add(seat.id);
    const role = roles.get(seat.spec.roleId);
    if (!role) {
      errors.push(`Seat "${seat.spec.name}" references unknown role ${seat.spec.roleId}`);
      continue;
    }
    const a = effectiveAuthority(role, seat);
    if (a.canPropose) proposers++;
    if (a.canJudge) judges++;
    if (a.canCritique) reviewers++;
    if (a.canJudge && a.canPropose) errors.push(`Seat "${seat.spec.name}" cannot both propose and judge`);
  }

  if (table.seats.length === 0) errors.push('A table needs at least one seat');
  if (proposers === 0) errors.push('At least one seat must be able to propose');
  if (judges === 0) errors.push('A table needs a Judge seat — no agent may approve its own work');
  if (judges > 1) errors.push('Only one Judge seat is allowed per table');
  if (table.protocol.critique && reviewers === 0) warnings.push('Critique is enabled but no seat can review');
  if (table.protocol.critique && reviewers === 1 && proposers === 1) warnings.push('The only reviewer is also the only author; no independent review will occur');

  const providers = new Set(table.seats.map((s) => s.spec.model.providerId));
  if (providers.size === 1 && table.seats.length > 1) warnings.push('All seats use the same provider — reviews may share blind spots');
  if (table.protocol.requireCrossProviderReview && providers.size < 2) errors.push('Cross-provider review is required but all seats use one provider');

  return { ok: errors.length === 0, errors, warnings };
}

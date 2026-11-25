import { AdminHttpError } from '@/lib/admin-auth';
import {
  PROTECTED_PLAN_KEYS,
  buildArchiveUpdate,
  buildPlanDocument,
  buildPlanUpdate,
  changedPlanFields,
  isDuplicateKey,
  planRevisionFilter,
  planRevisionOf,
  planSnapshot,
  toPlanRow,
  type PlanChanges,
  type PlanCreateInput,
} from '@/lib/admin-plans';
import type { Doc } from '@/lib/admin-stores';
import { SubscriptionPlanModel, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 6 EP-14.US01 (D-118): create, update and archive a subscription plan. Kept out of the route files (Next allows only route exports
 * there). Every write needs a reason, goes through the model, is conditional on the revision the admin saw (409 when someone else wrote
 * first), and leaves an audit entry. The audit entry is best effort, as for the seller status call (D-093): the change is already made. A
 * plan is never deleted: archiving is the only removal.
 */

const PlanModel = SubscriptionPlanModel as unknown as {
  findOne(filter: Doc): { select(fields: string): { lean(): Promise<Doc | null> } };
  findById(id: string): { lean(): Promise<Doc | null> };
  findOneAndUpdate(filter: Doc, update: Doc, options: Doc): { lean(): Promise<Doc | null> };
  create(doc: Doc): Promise<Doc & { toObject?: () => Doc }>;
};

const KEY_TAKEN = 'A plan with this key already exists.';
const CHANGED = 'The plan was changed by someone else. Reload and try again.';

async function audit(action: string, id: string, adminId: string, details: Doc): Promise<void> {
  try {
    await writeAuditLog(action, 'subscriptionPlan', id, adminId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write the plan audit entry', err instanceof Error ? err.message : 'unknown');
  }
}

export async function createPlan(adminId: string, input: PlanCreateInput & { reason: string }) {
  const taken = await PlanModel.findOne({ key: input.key }).select('_id').lean();
  if (taken) throw new AdminHttpError(409, KEY_TAKEN, 'PLAN_KEY_TAKEN', 'key');

  let created: Doc & { toObject?: () => Doc };
  try {
    created = await PlanModel.create(buildPlanDocument(input));
  } catch (err) {
    // Two creates racing: the unique index on the key decides.
    if (isDuplicateKey(err)) throw new AdminHttpError(409, KEY_TAKEN, 'PLAN_KEY_TAKEN', 'key');
    throw err;
  }
  const row = toPlanRow(typeof created.toObject === 'function' ? created.toObject() : created);
  await audit('plan.create', row.id, adminId, { reason: input.reason, after: planSnapshot(row) });
  return row;
}

export async function updatePlan(adminId: string, id: string, input: PlanChanges & { revision: number; reason: string }) {
  if (input.isActive === false) {
    throw new AdminHttpError(400, 'Use Archive to take a plan off sale.', 'ACCOUNT_BODY_INVALID', 'isActive');
  }
  const found = await PlanModel.findById(id).lean();
  if (!found) throw new AdminHttpError(404, 'Plan not found');
  if (planRevisionOf(found) !== input.revision) throw new AdminHttpError(409, CHANGED, 'PLAN_REVISION_CHANGED');

  const before = toPlanRow(found);
  const changes: PlanChanges = {
    name: input.name,
    priceRs: input.priceRs,
    limits: input.limits,
    features: input.features,
    sortOrder: input.sortOrder,
    stripePriceId: input.stripePriceId,
    isActive: input.isActive,
  };
  const applied = await PlanModel.findOneAndUpdate(planRevisionFilter(id, input.revision), buildPlanUpdate(changes), { new: true }).lean();
  if (!applied) throw new AdminHttpError(409, CHANGED, 'PLAN_REVISION_CHANGED');

  const row = toPlanRow(applied);
  await audit('plan.update', id, adminId, { reason: input.reason, changed: changedPlanFields(changes), before: planSnapshot(before), after: planSnapshot(row) });
  return row;
}

export async function archivePlan(adminId: string, id: string, input: { revision: number; reason: string }) {
  const found = await PlanModel.findById(id).lean();
  if (!found) throw new AdminHttpError(404, 'Plan not found');
  const before = toPlanRow(found);
  if (before.key !== null && PROTECTED_PLAN_KEYS.includes(before.key)) {
    throw new AdminHttpError(409, 'The Free plan cannot be archived: it is the plan every seller falls back to.', 'PLAN_PROTECTED');
  }
  if (!before.isActive) throw new AdminHttpError(409, 'This plan is already archived.', 'PLAN_ARCHIVED');
  if (before.revision !== input.revision) throw new AdminHttpError(409, CHANGED, 'PLAN_REVISION_CHANGED');

  const applied = await PlanModel.findOneAndUpdate(planRevisionFilter(id, input.revision), buildArchiveUpdate(new Date()), { new: true }).lean();
  if (!applied) throw new AdminHttpError(409, CHANGED, 'PLAN_REVISION_CHANGED');

  const row = toPlanRow(applied);
  await audit('plan.archive', id, adminId, { reason: input.reason, before: planSnapshot(before), after: planSnapshot(row) });
  return row;
}

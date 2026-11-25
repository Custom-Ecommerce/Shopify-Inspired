import { ContactMessage, NotificationOutbox, Product, StockMovement, SupportTicket, SyncOutbox, writeAuditLog } from '@/lib/services';
import { RETENTION_BATCH, RETENTION_DAYS, cutoffFor, type PurgeableTarget } from '@/lib/retention-policy';
import { purgeExpiredProducts, retentionFilter } from '@/lib/trash';

/**
 * Sprint 6 EP-29 (S6-B7): the purge. A DRY RUN unless `apply` is true: it counts what is past its period and removes nothing. Applying removes at most
 * RETENTION_BATCH rows per target per run (oldest first, by id, in one deleteMany), so a run is always bounded and a second run finds only what is left.
 * Only rows past the cutoff are ever selected; a sent row is never touched before its period. One audit line per run with the counts.
 * Product trash goes through the existing purge (reviews are archived first; a product an admin took down or deleted is kept for good).
 */

export interface TargetResult {
  key: PurgeableTarget;
  days: number;
  eligible: number;
  purged: number;
  more: boolean;
}
export interface RetentionRun {
  dryRun: boolean;
  targets: TargetResult[];
  at: string;
}

interface Spec {
  key: PurgeableTarget;
  days: number;
  model: { countDocuments(f: never): PromiseLike<number>; find(f: never): any; deleteMany(f: never): PromiseLike<{ deletedCount?: number }> };
  filter(cutoff: Date): Record<string, unknown>;
}

const specs = (): Spec[] => [
  { key: 'notification_outbox', days: RETENTION_DAYS.notificationOutboxSent, model: NotificationOutbox as never, filter: (c) => ({ status: 'sent', sentAt: { $lt: c } }) },
  { key: 'sync_outbox', days: RETENTION_DAYS.syncOutboxSent, model: SyncOutbox as never, filter: (c) => ({ status: 'sent', sentAt: { $lt: c } }) },
  { key: 'stock_movements', days: RETENTION_DAYS.stockMovements, model: StockMovement as never, filter: (c) => ({ changedAt: { $lt: c } }) },
];

/** Sprint 7 (S7-B4): only CLOSED rows, counted from their last change: 365 days for contact messages, 730 for tickets. An open or answered one is never selected. */
const supportSpecs = (): Spec[] => [
  { key: 'contact_messages', days: RETENTION_DAYS.contactMessages, model: ContactMessage as never, filter: (c) => ({ status: 'closed', updatedAt: { $lt: c } }) },
  { key: 'closed_tickets', days: RETENTION_DAYS.closedTickets, model: SupportTicket as never, filter: (c) => ({ status: 'closed', updatedAt: { $lt: c } }) },
];

export const retentionSteps = {
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

export async function runRetention(options: { apply: boolean; now: Date; actorId: string }): Promise<RetentionRun> {
  const { apply, now } = options;
  const targets: TargetResult[] = [];
  const runSpecs = async (list: Spec[]): Promise<void> => {
    for (const spec of list) {
    const filter = spec.filter(cutoffFor(now, spec.days));
    const eligible = await spec.model.countDocuments(filter as never);
    let purged = 0;
    if (apply && eligible > 0) {
      const rows = (await spec.model.find(filter as never).select('_id').sort({ _id: 1 }).limit(RETENTION_BATCH).lean()) as Array<{ _id: unknown }>;
      if (rows.length > 0) purged = (await spec.model.deleteMany({ _id: { $in: rows.map((r) => r._id) }, ...filter } as never)).deletedCount ?? 0;
    }
    targets.push({ key: spec.key, days: spec.days, eligible, purged, more: apply ? eligible > purged : eligible > RETENTION_BATCH });
    }
  };
  await runSpecs(specs());
  // The product trash keeps its own rules (365 days, never a product an admin took down or deleted).
  const trashEligible = await Product.countDocuments(retentionFilter(now) as never);
  let trashPurged = 0;
  let trashMore = trashEligible > RETENTION_BATCH;
  if (apply && trashEligible > 0) {
    const result = await purgeExpiredProducts(now);
    trashPurged = result.purged;
    trashMore = result.more;
  }
  targets.push({ key: 'product_trash', days: RETENTION_DAYS.productTrash, eligible: trashEligible, purged: trashPurged, more: trashMore });

  await runSpecs(supportSpecs());

  const run: RetentionRun = { dryRun: !apply, targets, at: now.toISOString() };
  try {
    await retentionSteps.audit('retention.run', 'retention', 'run', options.actorId, { apply, targets: targets.map((t) => ({ key: t.key, eligible: t.eligible, purged: t.purged })), at: run.at });
  } catch (err) {
    console.error('[seller-backend] could not write the retention audit entry', err instanceof Error ? err.name : 'unknown');
  }
  return run;
}

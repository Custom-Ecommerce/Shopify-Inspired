// Pure planning for scripts/backfill-order-phone-key.mjs (Sprint 5 EP-10.US01, D-108). No database, no env, no output.
// The phone rule is NOT here: the caller passes normalizePhoneE164 from @markaz/contracts, so there is one normaliser only.
// Tested by apps/seller/backend/test/phone-key-backfill.test.ts.

/** How many orders one bulk write holds. */
export const BATCH_SIZE = 500;

/**
 * May the script run against this database? Stricter than the admin bootstrap: only a database whose name contains
 * "throwaway" is allowed by itself. Any other name needs --i-know-this-is-real, for the dry run as well as for --apply.
 */
export function targetDecision(databaseName, { apply, iKnowThisIsReal }) {
  const name = String(databaseName ?? '').toLowerCase();
  if (name.includes('throwaway')) return { ok: true, reason: 'safe-name' };
  if (iKnowThisIsReal) return { ok: true, reason: apply ? 'confirmed-apply' : 'confirmed-dry-run' };
  return { ok: false, reason: 'needs-throwaway-name-or-flag' };
}

/** The filter that finds the orders still to do: no phoneKey yet and some phone text. Re-running it finds only what is left. */
export const PENDING_FILTER = Object.freeze({ phoneKey: { $exists: false }, phone: { $type: 'string', $ne: '' } });

/**
 * @param {Array<{ _id: unknown, phone?: unknown, phoneKey?: unknown }>} rows
 * @param {(phone: unknown) => string | null} normalize  normalizePhoneE164
 * @returns {{ updates: Array<{ id: unknown, phoneKey: string }>, counts: { seen: number, toSet: number, alreadyKeyed: number, noPhone: number, notMobile: number } }}
 */
export function planPhoneKeys(rows, normalize) {
  const updates = [];
  const counts = { seen: 0, toSet: 0, alreadyKeyed: 0, noPhone: 0, notMobile: 0 };
  for (const row of rows) {
    counts.seen += 1;
    if (typeof row.phoneKey === 'string' && row.phoneKey !== '') {
      counts.alreadyKeyed += 1;
      continue;
    }
    if (typeof row.phone !== 'string' || row.phone.trim() === '') {
      counts.noPhone += 1;
      continue;
    }
    const key = normalize(row.phone);
    if (key === null) {
      counts.notMobile += 1;
      continue;
    }
    updates.push({ id: row._id, phoneKey: key });
    counts.toSet += 1;
  }
  return { updates, counts };
}

/** The bulk operations for one plan: each only touches an order that still has no phoneKey, so a repeat or a race changes nothing. */
export function bulkOperations(updates) {
  return updates.map((update) => ({
    updateOne: { filter: { _id: update.id, phoneKey: { $exists: false } }, update: { $set: { phoneKey: update.phoneKey } } },
  }));
}

export function addCounts(total, part) {
  for (const key of Object.keys(part)) total[key] = (total[key] ?? 0) + part[key];
  return total;
}

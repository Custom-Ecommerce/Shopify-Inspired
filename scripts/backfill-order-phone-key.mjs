#!/usr/bin/env node
// Sprint 5 EP-10.US01 (D-108): writes Order.phoneKey (the normalized phone, +923xxxxxxxxx) on orders placed before it existed,
// so the seller's customers group by one phone however it was typed. New orders get it at creation.
//
//   dry run (default): reads, prints counts, writes nothing
//   --apply            writes phoneKey on the orders that have none
//   --i-know-this-is-real   needed for any database whose name does not contain "throwaway" (also for the dry run)
//
// The phone rule is normalizePhoneE164 from @markaz/contracts, loaded through tsx, so this script is started from the contracts
// package (where tsx is installed). From the repository root, with the seller backend's variables in an env file:
//
//   pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/backfill-order-phone-key.mjs
//   ... the same line followed by --apply
//   (root script: pnpm backfill:phone-key -- --apply, with SELLER_MONGODB_URI exported in the shell)
//
// It never updates phone or any other field, never touches updatedAt, never deletes, prints counts only (never a URI, a phone or
// an id), and is safe to run twice: it only ever sets a phoneKey that is absent.
// Reads SELLER_MONGODB_URI, or MONGODB_URI when that is not set.
import mongoose from 'mongoose';
import { normalizePhoneE164 } from '../packages/contracts/src/checkout.ts';
import { BATCH_SIZE, PENDING_FILTER, addCounts, bulkOperations, planPhoneKeys, targetDecision } from './lib/backfill-order-phone-key-plan.mjs';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const iKnowThisIsReal = args.has('--i-know-this-is-real');

function fail(message) {
  console.error(message + ' Nothing was written.');
  process.exitCode = 1;
}

function databaseNameOf(uri) {
  // A regex, not new URL(): a replica-set URI lists several hosts, which URL() rejects.
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function main() {
  const uri = ((process.env.SELLER_MONGODB_URI ?? '') || (process.env.MONGODB_URI ?? '')).trim();
  if (uri === '') return fail('SELLER_MONGODB_URI (or MONGODB_URI) is not set.');

  const decision = targetDecision(databaseNameOf(uri), { apply, iKnowThisIsReal });
  if (!decision.ok) return fail('The database name does not contain "throwaway". Add --i-know-this-is-real to run on it.');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const orders = mongoose.connection.collection('orders');
    const total = { seen: 0, toSet: 0, alreadyKeyed: 0, noPhone: 0, notMobile: 0 };
    let written = 0;
    let batch = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const plan = planPhoneKeys(batch, normalizePhoneE164);
      addCounts(total, plan.counts);
      if (apply && plan.updates.length > 0) {
        const result = await orders.bulkWrite(bulkOperations(plan.updates), { ordered: false });
        written += result.modifiedCount ?? 0;
      }
      batch = [];
    };

    // Only the orders still to do. A repeat of --apply finds nothing left to set.
    const cursor = orders.find(PENDING_FILTER, { projection: { phone: 1 } });
    for await (const row of cursor) {
      batch.push(row);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    const withKey = await orders.countDocuments({ phoneKey: { $exists: true } });
    console.log((apply ? 'APPLY' : 'DRY RUN') + ' (writes nothing unless --apply)');
    console.log('  orders without a phoneKey that have a phone: ' + total.seen);
    console.log('  to set (a Pakistani mobile number): ' + total.toSet);
    console.log('  not a mobile number, left without a key: ' + total.notMobile);
    console.log('  orders that already have a phoneKey: ' + withKey);
    if (apply) console.log('  written: ' + written);
    else console.log('  would write: ' + total.toSet);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('backfill-order-phone-key failed: ' + (err instanceof Error ? err.name : 'error'));
  process.exitCode = 1;
});

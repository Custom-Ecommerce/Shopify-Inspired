#!/usr/bin/env node
// Sprint 5 EP-13.US03.T02 (audit R1): moves the unique index of the commission ledger from { order, type, reversesType } to
// { order, type, reversesType, returnId }, so an order can carry one proportional reversal PER RETURN (the old key allowed one reversal
// per order, and the second partial return would have hit a duplicate key). Mongoose never alters a live index, so this does it.
//
//   dry run (default): reads the indexes, prints what it would do, changes nothing
//   --apply            creates the new index FIRST, checks it exists, and only then drops the old one
//   --i-know-this-is-real   needed for any database whose name does not contain "throwaway" (also for the dry run)
//
// Safe to run twice: when the new index is there and the old one is gone it does nothing. No entry is read or changed (an existing entry
// has no returnId, which the new key treats as null, exactly like the old key treated a missing reversesType). It prints index names and
// counts only, never a URI or a value. Reads SELLER_MONGODB_URI, or MONGODB_URI when that is not set.
//
// Run it the same way as the phone key backfill, from the repository root with the seller backend's variables in an env file:
//   pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/migrate-commission-index.mjs
//   ... the same line followed by --apply
//   (root script: pnpm migrate:commission-index -- --apply, with SELLER_MONGODB_URI exported in the shell)
import mongoose from 'mongoose';
import { COLLECTION, NEW_INDEX, isMissingCollection, planIndexMigration, targetDecision } from './lib/migrate-commission-index-plan.mjs';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const iKnowThisIsReal = args.has('--i-know-this-is-real');

function fail(message) {
  console.error(message + ' Nothing was changed.');
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

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (err) {
    if (isMissingCollection(err)) return [];
    throw err;
  }
}

async function main() {
  const uri = ((process.env.SELLER_MONGODB_URI ?? '') || (process.env.MONGODB_URI ?? '')).trim();
  if (uri === '') return fail('SELLER_MONGODB_URI (or MONGODB_URI) is not set.');

  const decision = targetDecision(databaseNameOf(uri), { apply, iKnowThisIsReal });
  if (!decision.ok) return fail('The database name does not contain "throwaway". Add --i-know-this-is-real to run on it.');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const collection = mongoose.connection.collection(COLLECTION);
    const before = await listIndexes(collection);
    const plan = planIndexMigration(before);

    console.log((apply ? 'APPLY' : 'DRY RUN') + ' (changes nothing unless --apply)');
    console.log('  indexes on ' + COLLECTION + ': ' + (before.map((index) => index.name).join(', ') || 'none (the collection does not exist yet)'));
    console.log('  state: ' + plan.state);
    for (const step of plan.steps) console.log('  ' + (apply ? 'doing' : 'would do') + ': ' + step.action + ' ' + step.name);
    if (plan.steps.length === 0) return;
    if (!apply) return;

    // The new index first: at no moment is the ledger without a unique guard.
    if (!plan.hasNew) {
      await collection.createIndex({ ...NEW_INDEX.key }, { name: NEW_INDEX.name, ...NEW_INDEX.options });
      console.log('  created: ' + NEW_INDEX.name);
    }
    if (plan.hasOld) {
      // Only drop the old one once the new one is really there.
      const check = planIndexMigration(await listIndexes(collection));
      if (!check.hasNew) return fail('The new index is not there after creating it, so the old one was kept.');
      const oldName = plan.steps.find((step) => step.action === 'drop').name;
      await collection.dropIndex(oldName);
      console.log('  dropped: ' + oldName);
    }
    const after = planIndexMigration(await listIndexes(collection));
    console.log('  state now: ' + after.state);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('migrate-commission-index failed: ' + (err instanceof Error ? err.name : 'error'));
  process.exitCode = 1;
});

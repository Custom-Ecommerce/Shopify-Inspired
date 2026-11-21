#!/usr/bin/env node
// Sprint 5 EP-11.US04.T04 (D-111 (7)): creates the indexes every model declares, in the shared database. The seller backend connects with
// bufferCommands false, so Mongoose builds no index at runtime: without this step the unique and TTL indexes of Sprint 5 (one review per order and
// product, one open abandoned cart per phone, the 7 day cart expiry, the return and blocklist uniques) do not exist.
//
//   dry run (default): reads the existing indexes, prints what is missing and what conflicts, changes nothing
//   --apply            runs createIndexes() for the models that miss an index
//   --i-know-this-is-real   needed for any database whose name does not contain "throwaway" (also for the dry run)
//
// createIndexes ONLY: it never calls syncIndexes and never drops an index, so an index nobody declares stays where it is. An index that exists
// with the same name but another definition is reported as a conflict and its model is skipped (fix it by hand or with a migration script such as
// migrate-commission-index.mjs, which must run FIRST). Safe to run twice: a second run finds nothing missing. It prints model, collection and
// index names and counts only, never a URI or a document value. A unique index can fail on data that already breaks it: that model is reported
// with the error name and the others are still done. Reads SELLER_MONGODB_URI, or MONGODB_URI when that is not set.
//
// Run it like the other scripts, from the repository root with the seller backend's variables in an env file:
//   pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/ensure-indexes.mjs
//   ... the same line followed by --apply
//   (root script: pnpm ensure:indexes -- --apply, with SELLER_MONGODB_URI exported in the shell)
import mongoose from 'mongoose';
// MUST stay above the db-schemas import: it switches autoCreate and autoIndex off before any model is compiled (SB-6, verification bug 1: the dry
// run used to create every collection and index on connect). Only --apply creates anything, through createIndexes() below.
import { NO_AUTO_CONNECT_OPTIONS } from './lib/mongoose-no-auto.mjs';
import '../packages/db-schemas/src/index.ts';
import { isMissingCollection, planAll, targetDecision } from './lib/ensure-indexes-plan.mjs';

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

async function existingIndexes(collectionName) {
  try {
    return await mongoose.connection.collection(collectionName).indexes();
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

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...NO_AUTO_CONNECT_OPTIONS });
  try {
    const models = Object.values(mongoose.models).map((model) => ({ model: model.modelName, collection: model.collection.name, declared: model.schema.indexes() }));
    const existing = {};
    for (const entry of models) existing[entry.collection] ??= await existingIndexes(entry.collection);
    const plan = planAll(models, existing);

    console.log((apply ? 'APPLY' : 'DRY RUN') + ' (changes nothing unless --apply)');
    for (const entry of plan.models) {
      if (entry.missing.length === 0 && entry.conflicts.length === 0) continue;
      console.log('  ' + entry.model + ' (' + entry.collection + '): ' + entry.missing.length + ' missing, ' + entry.conflicts.length + ' conflicting');
      for (const index of entry.missing) {
        console.log('    ' + (apply ? 'creating' : 'would create') + ' ' + index.name + (index.unique ? ' [unique]' : '') + (index.ttl ? ' [ttl]' : '') + (index.partial ? ' [partial]' : ''));
      }
      for (const index of entry.conflicts) console.log('    CONFLICT ' + index.name + ': ' + index.reason + ' (left as it is)');
    }
    console.log('  indexes present: ' + plan.totals.present + ', missing: ' + plan.totals.missing + ', conflicting: ' + plan.totals.conflicts);
    if (plan.totals.missing === 0 && plan.totals.conflicts === 0) return;
    if (!apply) return;

    let failed = 0;
    for (const name of plan.toCreate) {
      try {
        await mongoose.models[name].createIndexes();
        console.log('  created: ' + name);
      } catch (err) {
        failed += 1;
        console.error('  FAILED: ' + name + ' (' + (err instanceof Error ? err.name : 'error') + (typeof err?.codeName === 'string' ? ', ' + err.codeName : '') + ')');
      }
    }
    const skipped = plan.models.filter((entry) => entry.conflicts.length > 0).length;
    console.log('  done: ' + (plan.toCreate.length - failed) + ' models, failed: ' + failed + ', skipped for a conflict: ' + skipped);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('ensure-indexes failed: ' + (err instanceof Error ? err.name : 'error'));
  process.exitCode = 1;
});

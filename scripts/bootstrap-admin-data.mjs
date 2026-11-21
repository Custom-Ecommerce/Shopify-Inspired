#!/usr/bin/env node
// SB-12 (D-087, D-098, D-105): create the two admin documents that no code creates, in the ONE shared database.
//
//   node --env-file=apps/admin/backend/.env scripts/bootstrap-admin-data.mjs                 dry run (default): reads, prints counts
//   node --env-file=apps/admin/backend/.env scripts/bootstrap-admin-data.mjs --apply         writes what is missing
//   ... --i-know-this-is-real                                                                needed for any database whose name has neither "throwaway" nor "test"
//   (root script: pnpm bootstrap:admin -- --apply)
//
// Creates, only when missing:
//   1. the platform-settings document (collection globals, globalType platformSettings) with the defaults the code uses;
//   2. one `sellers` mirror row (_id = the seller user's id, sellerId = that id as text) per seller user that owns a store;
//   3. the plans "free" and "growth" (Sprint 6, D-118) in subscriptionPlans, each only when no plan has its key. A plan that exists is
//      never changed: an admin may have edited it in the console.
// It never updates or deletes an existing document, prints counts only (never a URI, an email or an id), and is safe to run twice.
// Reads MONGODB_URI. If SELLER_MONGODB_URI is also set it must name the same database, or the script stops.
import mongoose from 'mongoose';
import { planBootstrap, targetDecision, PLATFORM_SETTINGS_GLOBAL_TYPE } from './lib/bootstrap-admin-plan.mjs';

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
  const uri = (process.env.MONGODB_URI ?? '').trim();
  if (uri === '') return fail('MONGODB_URI is not set.');

  const sellerUri = (process.env.SELLER_MONGODB_URI ?? '').trim();
  if (sellerUri !== '' && databaseNameOf(sellerUri) !== databaseNameOf(uri)) {
    return fail('SELLER_MONGODB_URI and MONGODB_URI name different databases. Both must be the same database.');
  }

  const decision = targetDecision(databaseNameOf(uri), { apply, iKnowThisIsReal });
  if (!decision.ok) {
    return fail('The database name has neither "throwaway" nor "test". Add --i-know-this-is-real to run on it.');
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const db = mongoose.connection;
    const settingsDocs = await db.collection('globals').find({ globalType: PLATFORM_SETTINGS_GLOBAL_TYPE }, { projection: { _id: 1 } }).toArray();
    const sellerUsers = await db.collection('users').find({ role: 'seller' }, { projection: { _id: 1 } }).toArray();
    const stores = await db.collection('stores').find({ owner: { $ne: null } }, { projection: { owner: 1 } }).toArray();
    const sellerMirrors = await db.collection('sellers').find({}, { projection: { _id: 1, sellerId: 1 } }).toArray();

    const planDocs = await db.collection('subscriptionPlans').find({ key: { $type: 'string' } }, { projection: { key: 1 } }).toArray();

    const plan = planBootstrap({ settingsDocs, sellerUsers, stores, sellerMirrors, planDocs });

    let createdSettings = 0;
    let createdMirrors = 0;
    let createdPlans = 0;
    if (apply) {
      const now = new Date();
      for (const row of plan.createPlans) {
        try {
          await db.collection('subscriptionPlans').insertOne({ ...row, createdAt: now, updatedAt: now });
          createdPlans += 1;
        } catch (err) {
          if (err && err.code === 11000) continue; // the key appeared since the read (the unique index): left as it is
          throw err;
        }
      }
      if (plan.createSettings) {
        await db.collection('globals').insertOne({ ...plan.createSettings, createdAt: now, updatedAt: now });
        createdSettings = 1;
      }
      for (const row of plan.createMirrors) {
        // _id is the user's ObjectId (the stores.owner the dispatcher looks up); sellerId is the same id as text.
        try {
          await db.collection('sellers').insertOne({ _id: new mongoose.Types.ObjectId(row.id), sellerId: row.sellerId, createdAt: now, updatedAt: now });
          createdMirrors += 1;
        } catch (err) {
          if (err && err.code === 11000) continue; // appeared since the read: left as it is
          throw err;
        }
      }
    }

    console.log((apply ? 'APPLY' : 'DRY RUN') + ' (writes nothing unless --apply)');
    for (const [key, value] of Object.entries(plan.counts)) console.log('  ' + key + ': ' + value);
    if (apply) console.log('  created settings: ' + createdSettings + ', created mirrors: ' + createdMirrors + ', created plans: ' + createdPlans);
    else console.log('  would create settings: ' + plan.counts.settingsToCreate + ', would create mirrors: ' + plan.counts.mirrorsToCreate + ', would create plans: ' + plan.counts.plansToCreate);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('bootstrap-admin-data failed: ' + (err instanceof Error ? err.name : 'error'));
  process.exitCode = 1;
});

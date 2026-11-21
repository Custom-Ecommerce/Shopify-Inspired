#!/usr/bin/env node
// Sprint 6 (S6-B6, D-118): one-time migration. Every admin account with no adminLevel is made an owner, explicitly.
//
//   dry run (default): counts and prints what would change, changes nothing
//   --apply            writes adminLevel: 'owner' on those accounts (only accounts that still have no level: a second run finds nothing)
//   --i-know-this-is-real   needed for any database whose name does not contain "throwaway" (also for the dry run)
//
// Prints counts only, never a URI, an email or a document value. Reads SELLER_MONGODB_URI, or MONGODB_URI when that is not set (the shared database).
import mongoose from 'mongoose';
import { NO_AUTO_CONNECT_OPTIONS } from './lib/mongoose-no-auto.mjs';
import '../packages/db-schemas/src/index.ts';
import { targetDecision } from './lib/ensure-indexes-plan.mjs';
import { MISSING_LEVEL_FILTER, planAdminLevels } from './lib/admin-level-migration.mjs';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const iKnowThisIsReal = args.has('--i-know-this-is-real');

function fail(message) {
  console.error(message + ' Nothing was changed.');
  process.exitCode = 1;
}

function databaseNameOf(uri) {
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

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...NO_AUTO_CONNECT_OPTIONS });
  try {
    const users = mongoose.connection.collection('users');
    const admins = await users.find({ role: 'admin' }, { projection: { role: 1, adminLevel: 1 } }).toArray();
    const plan = planAdminLevels(admins);
    console.log('admin accounts: ' + admins.length + ', already with a level: ' + plan.alreadySet + ', to become owner: ' + plan.toOwner.length);
    if (!apply) return console.log('dry run: nothing was changed. Add --apply to write.');
    const result = await users.updateMany(MISSING_LEVEL_FILTER, { $set: { adminLevel: 'owner' } });
    console.log('updated: ' + result.modifiedCount);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('migrate-admin-levels failed: ' + (err instanceof Error ? err.name : 'unknown'));
  process.exitCode = 1;
});

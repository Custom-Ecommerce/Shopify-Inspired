#!/usr/bin/env node
// Sprint 4 EP-08.US02.T03: one-time migration. Every seller created before email verification existed is marked
// verified, so nobody is locked out of go-live or payouts.
//
//   cd apps/seller/backend
//   node --env-file=.env --import tsx scripts/mark-sellers-verified.mjs           (dry run: prints how many)
//   node --env-file=.env --import tsx scripts/mark-sellers-verified.mjs --apply   (sets emailVerifiedAt = now)
//
// Reads SELLER_MONGODB_URI. Prints counts only: never an email, a name or a secret. Run it once, right after the
// Sprint 4 deploy of the seller backend (SETUP.md, deploy notes). Running it again finds nothing left to do.
import mongoose from 'mongoose';
import * as dbNs from '@markaz/db-schemas';

const { User } = dbNs.default ?? dbNs;

/** Sellers with no emailVerifiedAt (missing or null). */
export const UNVERIFIED_SELLERS = { role: 'seller', $or: [{ emailVerifiedAt: { $exists: false } }, { emailVerifiedAt: null }] };

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = (process.env.SELLER_MONGODB_URI ?? '').trim();
  if (uri === '') {
    console.error('SELLER_MONGODB_URI is not set. Nothing was done.');
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const count = await User.countDocuments(UNVERIFIED_SELLERS);
    if (!apply) {
      console.log('Dry run: ' + count + ' seller account(s) would be marked verified. Run with --apply to do it.');
      return;
    }
    const result = await User.updateMany(UNVERIFIED_SELLERS, { $set: { emailVerifiedAt: new Date() } });
    console.log('Marked ' + result.modifiedCount + ' seller account(s) verified (' + count + ' found).');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('mark-sellers-verified failed: ' + (err instanceof Error ? err.message : 'unknown error'));
  process.exitCode = 1;
});

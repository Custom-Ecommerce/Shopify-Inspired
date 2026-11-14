#!/usr/bin/env node
// Sprint 4 EP-08.US05.T02 (CO-05): create the first platform operator account.
//
//   cd apps/admin/backend
//   node --env-file=.env --import tsx scripts/create-admin.mjs            (or: pnpm create-admin, with the env set)
//   node --env-file=.env --import tsx scripts/create-admin.mjs --force    (add another admin when one exists)
//
// Reads MONGODB_URI, ADMIN_EMAIL and ADMIN_PASSWORD (ADMIN_NAME optional) from the environment; asks for the email and
// the password (hidden) when they are not set. Refuses when an admin already exists unless --force. The password must
// follow the shared rule (@markaz/contracts passwordSchema). The password and its hash are never printed.
import readline from 'node:readline';
import mongoose from 'mongoose';
import * as dbNs from '@markaz/db-schemas';
import * as authNs from '@markaz/auth';
import * as contractsNs from '@markaz/contracts';
import { createFirstAdmin } from '../src/lib/create-admin.ts';

const pick = (ns) => ns.default ?? ns;
const { User } = pick(dbNs);
const { hashPassword } = pick(authNs);
const { passwordProblem } = pick(contractsNs);

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print the question once, then echo nothing while the password is typed.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const force = process.argv.includes('--force');
  const uri = (process.env.MONGODB_URI ?? '').trim();
  if (uri === '') {
    console.error('MONGODB_URI is not set. Nothing was done.');
    process.exitCode = 1;
    return;
  }
  const email = (process.env.ADMIN_EMAIL ?? '').trim() || (await ask('Admin email: ', false)).trim();
  const password = process.env.ADMIN_PASSWORD ?? (await ask('Admin password (hidden): ', true));
  const name = (process.env.ADMIN_NAME ?? '').trim() || undefined;

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await createFirstAdmin(User, { email, password, name, force }, { hashPassword, passwordProblem });
    if (result.ok) {
      console.log('Admin account created: ' + result.email + ' (id ' + result.id + ').');
    } else {
      console.error(result.message + ' Nothing was done.');
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  // Only the message: no stack with values, never the password.
  console.error('create-admin failed: ' + (err instanceof Error ? err.message : 'unknown error'));
  process.exitCode = 1;
});

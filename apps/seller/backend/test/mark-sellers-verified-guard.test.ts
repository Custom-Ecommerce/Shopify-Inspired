import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error plain .mjs module without types; tests are not type-checked
import * as guardNs from '../scripts/lib/target-guard.mjs';

// SB-6 (verification bug 10): scripts/mark-sellers-verified.mjs refuses a database whose name has no "throwaway" unless --i-know-this-is-real,
// the dry run included, and it decides BEFORE it connects (like the other four deploy scripts).

const guard = ((guardNs as { default?: unknown }).default ?? guardNs) as {
  databaseNameOf: (uri: string) => string;
  targetDecision: (name: string, flags: { apply: boolean; iKnowThisIsReal: boolean }) => { ok: boolean; reason: string };
};

test('the guard: throwaway always, anything else only with --i-know-this-is-real, for the dry run too', () => {
  assert.deepEqual(guard.targetDecision('markaz_throwaway_s5', { apply: true, iKnowThisIsReal: false }), { ok: true, reason: 'safe-name' });
  assert.deepEqual(guard.targetDecision('markaz-prod', { apply: false, iKnowThisIsReal: false }), { ok: false, reason: 'needs-throwaway-name-or-flag' });
  assert.deepEqual(guard.targetDecision('markaz-prod', { apply: true, iKnowThisIsReal: false }), { ok: false, reason: 'needs-throwaway-name-or-flag' });
  assert.equal(guard.targetDecision('markaz-prod', { apply: false, iKnowThisIsReal: true }).reason, 'confirmed-dry-run');
  assert.equal(guard.targetDecision('markaz-prod', { apply: true, iKnowThisIsReal: true }).reason, 'confirmed-apply');
  assert.equal(guard.targetDecision('', { apply: false, iKnowThisIsReal: false }).ok, false);
});

test('the database name is read from a plain or a multi-host Atlas URI (no new URL())', () => {
  assert.equal(guard.databaseNameOf('mongodb://127.0.0.1:27017/markaz_throwaway_x?retryWrites=true'), 'markaz_throwaway_x');
  assert.equal(guard.databaseNameOf('mongodb://h1:27017,h2:27017,h3:27017/markaz?replicaSet=r0'), 'markaz');
  assert.equal(guard.databaseNameOf('mongodb+srv://user:pw@cluster.example.net/some%20db?x=1'), 'some db');
  assert.equal(guard.databaseNameOf('mongodb://h1:27017'), '');
  assert.equal(guard.databaseNameOf(''), '');
});

test('the script checks the guard before it connects', () => {
  const source = readFileSync(join(process.cwd(), 'scripts', 'mark-sellers-verified.mjs'), 'utf8');
  const decideAt = source.indexOf('targetDecision(databaseNameOf(uri)');
  const connectAt = source.indexOf('mongoose.connect(');
  assert.ok(decideAt > 0 && connectAt > 0 && decideAt < connectAt);
  assert.match(source, /--i-know-this-is-real/);
});

test('run for real on a database named without "throwaway" (an unreachable host): dry run and --apply both stop at the guard, exit 1', () => {
  for (const args of [[], ['--apply']]) {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/mark-sellers-verified.mjs', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, SELLER_MONGODB_URI: 'mongodb://127.0.0.1:1/markaz_realprobe?serverSelectionTimeoutMS=2000' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const text = (run.stdout ?? '') + (run.stderr ?? '');
    assert.equal(run.status, 1, args.join(' ') + ': ' + text);
    assert.match(text, /does not contain "throwaway"/);
    assert.match(text, /Nothing was changed/);
    assert.doesNotMatch(text, /ECONNREFUSED|ServerSelection/, 'it never tried to connect');
  }
});

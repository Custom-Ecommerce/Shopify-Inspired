import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmEmailToken,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  sendEmailVerification,
  type AccountEmail,
  type AccountFlowDeps,
  type AccountUserModelPort,
} from '../src';
import { fakeTokens } from './helpers/fake-tokens';

// Sprint 4 EP-08: the shared account flows with fake models. No database, no email leaves.

type Row = Record<string, any>;

function cond(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
    const ops = expected as Row;
    if ('$ne' in ops) return String(actual) !== String(ops.$ne);
    throw new Error('unsupported condition');
  }
  if (expected === null) return actual === null || actual === undefined;
  return String(actual) === String(expected);
}
const matches = (row: Row, filter: Row) => Object.entries(filter).every(([k, v]) => cond(row[k], v));

function fakeUsers(initial: Row[]) {
  const rows = initial.map((r) => ({ ...r }));
  const chain = (value: () => unknown) => {
    const q: any = { select: () => q, lean: async () => value() };
    return q;
  };
  const model: AccountUserModelPort = {
    findOne: (filter) => chain(() => {
      const row = rows.find((r) => matches(r, filter));
      return row ? { ...row } : null;
    }),
    findOneAndUpdate: (filter, update) =>
      chain(() => {
        const row = rows.find((r) => matches(r, filter));
        if (!row) return null;
        Object.assign(row, (update as Row).$set ?? {});
        for (const [k, by] of Object.entries((update as Row).$inc ?? {})) row[k] = (row[k] ?? 0) + (by as number);
        return { ...row };
      }),
  };
  return { rows, model };
}

const SELLER = '65a000000000000000000001';
const OTHER = '65a000000000000000000002';
const ADMIN = '65a000000000000000000003';

function setup(users: Row[]) {
  const u = fakeUsers(users);
  const t = fakeTokens();
  const sent: AccountEmail[] = [];
  const forgotten: string[] = [];
  const deps: AccountFlowDeps = {
    users: u.model,
    tokens: t.model,
    hashPassword: async (plain) => 'hash:' + plain,
    sendEmail: (email) => void sent.push(email),
    link: (path) => 'https://seller.example.com' + path,
    forgetSession: (id) => void forgotten.push(id),
    role: 'seller',
    appName: 'Markazify',
  };
  const tokenOf = (email: AccountEmail): string => new URL(email.vars.actionLink!).searchParams.get('token')!;
  return { users: u.rows, tokens: t.rows, sent, forgotten, deps, tokenOf };
}

const seller = { _id: SELLER, name: 'Ayesha', email: 'ayesha@example.com', role: 'seller', passwordHash: 'old', tokenVersion: 2 };

test('forgot password emails a link only to an active account of the role; everything else sends nothing', async () => {
  const s = setup([seller, { _id: OTHER, email: 'held@example.com', role: 'seller', accountStatus: 'suspended' }, { _id: ADMIN, email: 'op@example.com', role: 'admin' }]);
  await requestPasswordReset(s.deps, 'nobody@example.com');
  await requestPasswordReset(s.deps, 'held@example.com');
  await requestPasswordReset(s.deps, 'op@example.com');
  assert.equal(s.sent.length, 0);
  assert.equal(s.tokens.length, 0);

  await requestPasswordReset(s.deps, ' Ayesha@Example.com ');
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.template, 'password_reset');
  assert.equal(s.sent[0]!.to, 'ayesha@example.com');
  assert.ok(s.sent[0]!.vars.actionLink!.startsWith('https://seller.example.com/reset-password?token='));
});

test('reset sets the new hash, bumps tokenVersion, clears the cache entry and sends the confirmation; the link works once', async () => {
  const s = setup([seller]);
  await requestPasswordReset(s.deps, 'ayesha@example.com');
  const raw = s.tokenOf(s.sent[0]!);

  const result = await resetPassword(s.deps, raw, 'new-password-1');
  assert.deepEqual(result, { ok: true, userId: SELLER });
  assert.equal(s.users[0]!.passwordHash, 'hash:new-password-1');
  assert.equal(s.users[0]!.tokenVersion, 3);
  assert.deepEqual(s.forgotten, [SELLER]);
  assert.equal(s.sent[1]!.template, 'password_changed');

  assert.deepEqual(await resetPassword(s.deps, raw, 'again-password'), { ok: false, code: 'TOKEN_INVALID' });
  assert.deepEqual(await resetPassword(s.deps, 'not-a-token', 'again-password'), { ok: false, code: 'TOKEN_INVALID' });
  assert.equal(s.users[0]!.passwordHash, 'hash:new-password-1');
});

test('email verification sets emailVerifiedAt once; an already verified account is fine', async () => {
  const s = setup([{ ...seller, emailVerifiedAt: null }]);
  await sendEmailVerification(s.deps, { id: SELLER, email: 'ayesha@example.com', name: 'Ayesha' });
  assert.equal(s.sent[0]!.template, 'email_verify');
  const first = await confirmEmailToken(s.deps, s.tokenOf(s.sent[0]!));
  assert.equal(first.ok, true);
  const verifiedAt = s.users[0]!.emailVerifiedAt;
  assert.ok(verifiedAt instanceof Date);

  assert.deepEqual(await confirmEmailToken(s.deps, s.tokenOf(s.sent[0]!)), { ok: false, code: 'TOKEN_INVALID' }, 'a used link');
  await sendEmailVerification(s.deps, { id: SELLER, email: 'ayesha@example.com' });
  const again = await confirmEmailToken(s.deps, s.tokenOf(s.sent[1]!));
  assert.equal(again.ok, true);
  assert.equal(s.users[0]!.emailVerifiedAt, verifiedAt, 'the first verification time is kept');
});

test('an email change swaps the address only when the link is used, and re-checks that it is free', async () => {
  const s = setup([{ ...seller }, { _id: OTHER, email: 'taken@example.com', role: 'seller' }]);
  assert.deepEqual(await requestEmailChange(s.deps, SELLER, 'taken@example.com'), { ok: false, code: 'EMAIL_TAKEN' });

  assert.deepEqual(await requestEmailChange(s.deps, SELLER, 'New@Example.com', 'Ayesha'), { ok: true });
  assert.equal(s.users[0]!.email, 'ayesha@example.com', 'the old email stays the login');
  assert.equal(s.users[0]!.pendingEmail, 'new@example.com');
  const mail = s.sent[0]!;
  assert.equal(mail.template, 'email_change_verify');
  assert.equal(mail.to, 'new@example.com');

  const done = await confirmEmailToken(s.deps, s.tokenOf(mail));
  assert.deepEqual(done, { ok: true, userId: SELLER, kind: 'email_change', email: 'new@example.com' });
  assert.equal(s.users[0]!.email, 'new@example.com');
  assert.equal(s.users[0]!.pendingEmail, null);
  assert.equal(s.users[0]!.tokenVersion, 3, 'other sessions end');
  assert.ok(s.users[0]!.emailVerifiedAt instanceof Date);
});

test('an email change whose address was taken in the meantime is refused', async () => {
  const s = setup([{ ...seller }]);
  await requestEmailChange(s.deps, SELLER, 'later@example.com');
  s.users.push({ _id: OTHER, email: 'later@example.com', role: 'seller' });
  assert.deepEqual(await confirmEmailToken(s.deps, s.tokenOf(s.sent[0]!)), { ok: false, code: 'EMAIL_TAKEN' });
  assert.equal(s.users[0]!.email, 'ayesha@example.com');
});

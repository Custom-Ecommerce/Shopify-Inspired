import { randomBytes } from 'node:crypto';
import type { AdminUser } from '../../../../../packages/contracts/src/admin-users';
import { AdminHttpError } from '@/lib/admin-auth';
import { adminConsoleLink, enqueueEmail, passwordProblem } from '@/lib/admin-account';
import { revokeAdminMobileDevices } from '@/lib/mobile-auth';
import { AuthToken, User, assertCan, effectiveAdminLevel, hashPassword, writeAuditLog } from '@/lib/workspace';
import * as authNs from '@markaz/auth';
import { unwrapCjs } from '@/lib/cjs';

const auth = unwrapCjs(authNs) as typeof authNs;

/**
 * Sprint 6 EP-20 (S6-B6, D-118): admin users and levels. Every route that reaches these functions has already passed the users.manage capability
 * (owner level) in authorizeAdmin; the policy row adminUsers says again what may be written. An admin account is disabled, never deleted.
 *
 *   last owner      the last ACTIVE owner can neither be disabled nor demoted (409 LAST_OWNER). Two owners changing each other at the very same
 *                   instant both pass the first check, so it is made again AFTER the write: whoever finds no other active owner takes its own
 *                   change back (409). No lock: in the worst case both are refused and nobody changes.
 *   self            an admin cannot change their own level or disable themselves (403 SELF_CHANGE).
 *   audit           every change writes who, the target, from, to and the reason.
 *   invite          a new account with a random password nobody knows, and a 7 day single-use link (the token is stored hashed). The person sets the
 *                   password through the link; until then the account cannot sign in.
 */

export const adminUserSteps = {
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

type Doc = Record<string, any>;
const FIELDS = 'name email adminLevel accountStatus emailVerifiedAt createdAt';
const OWNER_FILTER = { $or: [{ adminLevel: 'owner' }, { adminLevel: null }] };

export function toAdminUser(doc: Doc): AdminUser {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    email: String(doc.email ?? ''),
    // An unknown stored level has no rights at all; it is shown as the least privileged level, never as owner.
    adminLevel: effectiveAdminLevel(doc.adminLevel) ?? 'customer_support',
    accountStatus: ['suspended', 'blocked'].includes(doc.accountStatus) ? doc.accountStatus : 'active',
    accepted: Boolean(doc.emailVerifiedAt),
    createdAt: new Date(doc.createdAt ?? 0).toISOString(),
  };
}

async function audit(action: string, targetId: string, actorId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await adminUserSteps.audit(action, 'user', targetId, actorId, { ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write an admin user audit entry', err instanceof Error ? err.message : 'unknown');
  }
}

export async function listAdminUsers(): Promise<{ users: AdminUser[] }> {
  assertCan('admin', 'read', 'adminUsers', ['name', 'email', 'adminLevel', 'accountStatus']);
  const rows = (await User.find({ role: 'admin' } as never).select(FIELDS).sort({ createdAt: 1 }).lean()) as unknown as Doc[];
  return { users: rows.map(toAdminUser) };
}

async function loadAdmin(id: string): Promise<Doc> {
  const doc = (await User.findOne({ _id: id, role: 'admin' } as never).select(FIELDS).lean()) as unknown as Doc | null;
  if (!doc) throw new AdminHttpError(404, 'Admin user not found');
  return doc;
}

/** Other ACTIVE owners than this one. */
async function otherActiveOwners(targetId: string): Promise<number> {
  return User.countDocuments({ role: 'admin', accountStatus: 'active', _id: { $ne: targetId }, ...OWNER_FILTER } as never);
}

export async function inviteAdminUser(actorId: string, input: { name: string; email: string; adminLevel: string }): Promise<{ user: AdminUser }> {
  assertCan('admin', 'create', 'adminUsers', ['name', 'email', 'adminLevel']);
  if (await User.findOne({ email: input.email } as never).select('_id').lean()) throw new AdminHttpError(409, 'An account with this email already exists.', 'EMAIL_TAKEN', 'email');
  const passwordHash = (await hashPassword(randomBytes(32).toString('base64url'))) as string;
  let created: Doc;
  try {
    created = (await User.create({ name: input.name, email: input.email, role: 'admin', adminLevel: input.adminLevel, store: null, passwordHash, accountStatus: 'active', tokenVersion: 0 } as never)) as unknown as Doc;
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000) throw new AdminHttpError(409, 'An account with this email already exists.', 'EMAIL_TAKEN', 'email');
    throw err;
  }
  const id = String(created._id);
  const { raw } = await auth.createAuthToken(AuthToken as unknown as authNs.AuthTokenModelPort, { userId: id, kind: 'admin_invite' });
  await enqueueEmail({
    template: 'admin_invite' as never,
    to: input.email,
    vars: { appName: 'Markazify admin', customerName: input.name, actionLink: adminConsoleLink('/accept-invite?token=' + raw) ?? 'your admin console (ask the owner for the link)', validFor: '7 days' },
    dedupeKey: 'admin_invite:' + id,
  } as never).catch((err: unknown) => console.error('[admin-backend] could not queue an invitation', err instanceof Error ? err.message : 'unknown'));
  await audit('admin_user.invited', id, actorId, { email: input.email, adminLevel: input.adminLevel });
  // create() answers a Mongoose document: spreading it copies none of its fields, so it is turned into a plain object first.
  const plain = typeof created.toObject === 'function' ? (created.toObject() as Doc) : created;
  return { user: toAdminUser({ ...plain, adminLevel: input.adminLevel, accountStatus: 'active', emailVerifiedAt: null }) };
}

/** The invited person sets their password with the link: once, within 7 days. */
export async function acceptAdminInvite(token: string, password: string): Promise<{ ok: true }> {
  const problem = passwordProblem(password);
  if (problem !== null) throw new AdminHttpError(400, 'The password is not accepted: ' + problem + '.', 'ACCOUNT_BODY_INVALID', 'password');
  const consumed = await auth.consumeAuthToken(AuthToken as unknown as authNs.AuthTokenModelPort, token, ['admin_invite']);
  if (!consumed) throw new AdminHttpError(400, 'This link is not valid any more. Ask the owner for a new invitation.', 'TOKEN_INVALID');
  const passwordHash = (await hashPassword(password)) as string;
  const updated = await User.findOneAndUpdate({ _id: consumed.userId, role: 'admin', emailVerifiedAt: null } as never, { $set: { passwordHash, emailVerifiedAt: new Date(), accountStatus: 'active' }, $inc: { tokenVersion: 1 } } as never, { new: true })
    .select('_id')
    .lean();
  if (!updated) throw new AdminHttpError(400, 'This link is not valid any more. Ask the owner for a new invitation.', 'TOKEN_INVALID');
  await audit('admin_user.invite_accepted', consumed.userId, consumed.userId, {});
  return { ok: true };
}

export async function changeAdminLevel(actorId: string, targetId: string, input: { adminLevel: string; reason: string }): Promise<{ user: AdminUser; changed: boolean }> {
  assertCan('admin', 'update', 'adminUsers', ['adminLevel']);
  if (targetId === actorId) throw new AdminHttpError(403, 'You cannot change your own level.', 'SELF_CHANGE');
  const target = await loadAdmin(targetId);
  const from = effectiveAdminLevel(target.adminLevel) ?? 'customer_support';
  if (from === input.adminLevel) return { user: toAdminUser(target), changed: false };
  if (from === 'owner' && target.accountStatus !== 'suspended' && (await otherActiveOwners(targetId)) === 0) {
    throw new AdminHttpError(409, 'This is the last active owner. Make someone else an owner first.', 'LAST_OWNER');
  }
  const updated = (await User.findOneAndUpdate(
    { _id: targetId, role: 'admin', adminLevel: from === 'owner' ? { $in: ['owner', null] } : from } as never,
    { $set: { adminLevel: input.adminLevel } } as never,
    { new: true },
  )
    .select(FIELDS)
    .lean()) as unknown as Doc | null;
  if (!updated) throw new AdminHttpError(409, 'This account was changed by someone else. Reload and try again.', 'CHANGED');
  if (from === 'owner' && target.accountStatus !== 'suspended' && (await otherActiveOwners(targetId)) === 0) {
    await User.findOneAndUpdate({ _id: targetId, role: 'admin', adminLevel: input.adminLevel } as never, { $set: { adminLevel: 'owner' } } as never, { new: true }).select('_id').lean();
    throw new AdminHttpError(409, 'This is the last active owner. Make someone else an owner first.', 'LAST_OWNER');
  }
  await audit('admin_user.level_changed', targetId, actorId, { from, to: input.adminLevel, reason: input.reason });
  return { user: toAdminUser(updated), changed: true };
}

export async function setAdminStatus(actorId: string, targetId: string, status: 'suspended' | 'active', input: { reason: string }): Promise<{ user: AdminUser; changed: boolean }> {
  assertCan('admin', 'update', 'adminUsers', ['accountStatus', 'suspensionReason']);
  if (targetId === actorId) throw new AdminHttpError(403, 'You cannot disable yourself.', 'SELF_CHANGE');
  const target = await loadAdmin(targetId);
  const from = target.accountStatus === 'suspended' ? 'suspended' : 'active';
  if (from === status) return { user: toAdminUser(target), changed: false };
  if (status === 'suspended' && effectiveAdminLevel(target.adminLevel) === 'owner' && (await otherActiveOwners(targetId)) === 0) {
    throw new AdminHttpError(409, 'This is the last active owner and cannot be disabled.', 'LAST_OWNER');
  }
  const updated = (await User.findOneAndUpdate(
    { _id: targetId, role: 'admin', accountStatus: from === 'active' ? { $in: ['active', null] } : from } as never,
    { $set: { accountStatus: status, suspensionReason: status === 'suspended' ? input.reason : null }, ...(status === 'suspended' ? { $inc: { tokenVersion: 1 } } : {}) } as never,
    { new: true },
  )
    .select(FIELDS)
    .lean()) as unknown as Doc | null;
  if (!updated) throw new AdminHttpError(409, 'This account was changed by someone else. Reload and try again.', 'CHANGED');
  if (status === 'suspended' && effectiveAdminLevel(target.adminLevel) === 'owner' && (await otherActiveOwners(targetId)) === 0) {
    await User.findOneAndUpdate({ _id: targetId, role: 'admin', accountStatus: 'suspended' } as never, { $set: { accountStatus: 'active', suspensionReason: null } } as never, { new: true }).select('_id').lean();
    throw new AdminHttpError(409, 'This is the last active owner and cannot be disabled.', 'LAST_OWNER');
  }
  // Sprint 9 (EP-31.US01.T06): being enabled again does not bring the phones back.
  if (status === 'suspended') await revokeAdminMobileDevices(targetId, 'account_disabled');
  await audit(status === 'suspended' ? 'admin_user.disabled' : 'admin_user.enabled', targetId, actorId, { from, to: status, reason: input.reason });
  return { user: toAdminUser(updated), changed: true };
}

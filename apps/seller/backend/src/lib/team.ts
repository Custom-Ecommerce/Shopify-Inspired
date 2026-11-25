import mongoose from 'mongoose';
import type { TeamAcceptResponse, TeamInviteInfo, TeamListResponse, TeamMember } from '@markaz/contracts';
import { INVITE_INVALID_MESSAGE, TEAM_ERROR_CODES, TEAM_INVITE_TTL_DAYS } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { databaseReady, enqueueEmail, runAfterResponse, sellerDashboardLink } from '@/lib/notifications';
import { assertWithinPlan, canCheckPlans, loadEffectivePlan } from '@/lib/plan';
import { sellerPortalLink } from '@/lib/account-support';
import { generateRawToken, hashAuthToken, isRawTokenShape, Store, StoreMember, User, writeAuditLog } from '@/lib/services';

/*
 * Sprint 8 (S8-B2, D-118): a store's team. Pure helpers and the service functions the team routes call (kept out of the route files). The routes are owner-only
 * (capability team.manage) and run in the standard order; every change is ONE compare-and-set on the member's revision and an audit entry that records the acting
 * user and role. The invite token is 32 random bytes (packages/auth helpers): only its SHA-256 hash is stored, the raw value exists in the emailed link alone, and it
 * is never logged, audited or answered.
 */

const DAY_MS = 86_400_000;

type Row = Record<string, any>;

export const ROLE_LABELS: Readonly<Record<string, string>> = { manager: 'Manager', staff: 'Staff', support: 'Support' };

export const invalidInvite = (): HttpError => new HttpError(400, INVITE_INVALID_MESSAGE, TEAM_ERROR_CODES.INVITE_INVALID);
const memberNotFound = (): HttpError => new HttpError(404, 'Team member not found');
const memberChanged = (): HttpError => new HttpError(409, 'This person was changed in another tab. Reload and try again.', TEAM_ERROR_CODES.MEMBER_CHANGED);
const wrongState = (message: string): HttpError => new HttpError(409, message, TEAM_ERROR_CODES.MEMBER_STATE);

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : typeof value === 'string' && value !== '' ? value : null);

/** The link of an invite in the seller portal: /accept-invite?token=<raw>. Null when APP_BASE_URL_SELLER is not usable. */
export function inviteLink(raw: string): string | null {
  return sellerPortalLink('/accept-invite?token=' + encodeURIComponent(raw));
}

/** A fresh invite token: the raw value (for the link only), its hash (for the row) and the end of the invite. */
export function newInviteToken(now: Date = new Date()): { raw: string; tokenHash: string; expiresAt: Date } {
  const raw = generateRawToken();
  return { raw, tokenHash: hashAuthToken(raw), expiresAt: new Date(now.getTime() + TEAM_INVITE_TTL_DAYS * DAY_MS) };
}

/** One member as the owner reads it. Never the token hash, never the user id of someone else's account. */
export function toTeamMember(row: Row, name: string | null = null, now: Date = new Date()): TeamMember {
  const expires = row.expiresAt instanceof Date ? row.expiresAt : null;
  const open = row.status === 'invited';
  return {
    id: String(row._id),
    email: String(row.email ?? ''),
    name,
    role: row.role,
    status: row.status,
    invitedAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    inviteExpiresAt: open ? iso(row.expiresAt) : null,
    inviteExpired: open && expires !== null && expires.getTime() <= now.getTime(),
    acceptedAt: iso(row.acceptedAt),
    revision: typeof row.revision === 'number' ? row.revision : 0,
  };
}

export interface TeamActor {
  userId: string;
  userObjectId: mongoose.Types.ObjectId;
  /** The role the actor holds in this store (always owner for the team routes). */
  role: string;
}

async function audit(action: string, storeId: string, actor: TeamActor, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'store', storeId, 'seller:' + actor.userId, { actorRole: actor.role, ...details, at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the team audit entry', err instanceof Error ? err.message : 'unknown');
  }
}

interface StoreFacts {
  name: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
}

async function storeFacts(storeId: string): Promise<StoreFacts> {
  const store = (await Store.findById(storeId).select('name owner').lean()) as unknown as Row | null;
  if (!store) throw new HttpError(404, 'Store not found');
  const owner = store.owner ? ((await User.findById(String(store.owner)).select('email name').lean()) as unknown as Row | null) : null;
  return { name: String(store.name ?? ''), ownerId: String(store.owner ?? ''), ownerEmail: String(owner?.email ?? '').toLowerCase(), ownerName: String(owner?.name ?? '') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Emails (after the response, never throw)

function queueInvite(email: string, raw: string, store: StoreFacts, role: string, memberId: string, revision: number): void {
  runAfterResponse('staff_invite', async () => {
    if (!databaseReady()) return;
    await enqueueEmail({
      template: 'staff_invite',
      to: email,
      vars: {
        storeName: store.name,
        memberRole: ROLE_LABELS[role] ?? role,
        invitedBy: store.ownerName || store.ownerEmail || 'the store owner',
        actionLink: inviteLink(raw) ?? 'the Markazify seller portal (ask the store owner for the link)',
        validFor: TEAM_INVITE_TTL_DAYS + ' days',
      },
      // A resend is a new revision, so it queues a new email; the same call twice queues one.
      dedupeKey: 'staff_invite:' + memberId + ':' + revision,
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The list

export async function listTeam(storeId: string, ownerId: string, now: Date = new Date()): Promise<TeamListResponse> {
  const rows = (await StoreMember.find({ store: storeId }).sort({ createdAt: 1 }).lean()) as unknown as Row[];
  const userIds = rows.filter((row) => row.user).map((row) => String(row.user));
  const users = userIds.length === 0 ? [] : ((await User.find({ _id: { $in: userIds } }).select('name').lean()) as unknown as Row[]);
  const names = new Map(users.map((user) => [String(user._id), typeof user.name === 'string' ? user.name : null]));
  const used = rows.filter((row) => row.status === 'invited' || row.status === 'active').length;
  const limit = canCheckPlans() ? (await loadEffectivePlan(ownerId, now)).limits.staffSeats : null;
  return { members: rows.map((row) => toTeamMember(row, row.user ? (names.get(String(row.user)) ?? null) : null, now)), seats: { used, limit } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Invite and resend

export async function inviteMember(storeId: string, actor: TeamActor, body: { email: string; role: string }, now: Date = new Date()): Promise<TeamMember> {
  const store = await storeFacts(storeId);
  // The owner is already in the store: their own address cannot be invited to it.
  if (body.email === store.ownerEmail) {
    throw new HttpError(409, 'That is the owner account of this store. It already has full access.', TEAM_ERROR_CODES.OWNER_EMAIL, 'email');
  }
  const existing = (await StoreMember.findOne({ store: storeId, email: body.email }).lean()) as unknown as Row | null;
  if (existing) {
    if (existing.status === 'invited') throw new HttpError(409, 'This person already has an open invitation. Resend it instead.', TEAM_ERROR_CODES.INVITE_EXISTS, 'email');
    throw new HttpError(409, 'This person is already on your team.', TEAM_ERROR_CODES.ALREADY_MEMBER, 'email');
  }
  // After the ownership checks, before the write (403 PLAN_LIMIT_REACHED): invited and active members hold the seats.
  await assertWithinPlan({ kind: 'staffSeats', ownerId: store.ownerId, storeId, adding: 1, now });

  const token = newInviteToken(now);
  let created: Row;
  try {
    created = (await StoreMember.create({
      store: storeId,
      email: body.email,
      role: body.role,
      status: 'invited',
      invitedBy: actor.userObjectId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      revision: 0,
    })) as unknown as Row;
  } catch (err) {
    // Two invites at once: the unique partial index {store, email} (status invited) lets one win.
    if (isDuplicateKeyError(err)) throw new HttpError(409, 'This person already has an open invitation. Resend it instead.', TEAM_ERROR_CODES.INVITE_EXISTS, 'email');
    throw err;
  }
  const row = typeof created.toObject === 'function' ? created.toObject() : created;
  queueInvite(body.email, token.raw, store, body.role, String(row._id), 0);
  await audit('team.invite', storeId, actor, { memberId: String(row._id), invitedRole: body.role, email: body.email });
  return toTeamMember(row, null, now);
}

async function readMember(storeId: string, memberId: string): Promise<Row> {
  if (!mongoose.isValidObjectId(memberId)) throw memberNotFound();
  const row = (await StoreMember.findOne({ _id: memberId, store: storeId }).lean()) as unknown as Row | null;
  if (!row) throw memberNotFound();
  return row;
}

/** The one compare-and-set write of every change: the store, the revision that was read and (where it matters) the status. */
async function change(storeId: string, memberId: string, revision: number, status: string | null, set: Record<string, unknown>, unset: Record<string, unknown> = {}): Promise<Row> {
  const updated = (await StoreMember.findOneAndUpdate(
    { _id: memberId, store: storeId, revision, ...(status === null ? {} : { status }) },
    { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}), $inc: { revision: 1 } },
    { new: true },
  ).lean()) as unknown as Row | null;
  if (!updated) throw memberChanged();
  return updated;
}

/** A new link for an open invite; the old one stops working at once (its hash is replaced). */
export async function resendInvite(storeId: string, actor: TeamActor, memberId: string, revision: number, now: Date = new Date()): Promise<TeamMember> {
  const current = await readMember(storeId, memberId);
  if (current.status !== 'invited') throw wrongState('Only an open invitation can be sent again.');
  const store = await storeFacts(storeId);
  const token = newInviteToken(now);
  const updated = await change(storeId, memberId, revision, 'invited', { tokenHash: token.tokenHash, expiresAt: token.expiresAt });
  queueInvite(String(updated.email), token.raw, store, String(updated.role), memberId, updated.revision);
  await audit('team.resend', storeId, actor, { memberId, invitedRole: updated.role });
  return toTeamMember(updated, null, now);
}

// ---------------------------------------------------------------------------------------------------------------------
// Role, disable, enable, remove

export async function changeMemberRole(storeId: string, actor: TeamActor, memberId: string, role: string, revision: number): Promise<TeamMember> {
  const current = await readMember(storeId, memberId);
  const updated = await change(storeId, memberId, revision, null, { role });
  await audit('team.role', storeId, actor, { memberId, from: current.role, to: role });
  return toTeamMember(updated);
}

export async function disableMember(storeId: string, actor: TeamActor, memberId: string, revision: number): Promise<TeamMember> {
  const current = await readMember(storeId, memberId);
  if (current.status !== 'active') throw wrongState('Only an active member can be disabled. Remove an invitation instead.');
  const updated = await change(storeId, memberId, revision, 'active', { status: 'disabled' });
  await audit('team.disable', storeId, actor, { memberId, role: updated.role });
  return toTeamMember(updated);
}

/** A disabled member gets their access back, and the seat is counted again, so a full team refuses (403 PLAN_LIMIT_REACHED). */
export async function enableMember(storeId: string, actor: TeamActor, memberId: string, revision: number): Promise<TeamMember> {
  const current = await readMember(storeId, memberId);
  if (current.status !== 'disabled') throw wrongState('Only a disabled member can be enabled.');
  const store = await storeFacts(storeId);
  await assertWithinPlan({ kind: 'staffSeats', ownerId: store.ownerId, storeId, adding: 1 });
  const updated = await change(storeId, memberId, revision, 'disabled', { status: 'active' });
  await audit('team.enable', storeId, actor, { memberId, role: updated.role });
  return toTeamMember(updated);
}

/** Deletes the row (a member, a disabled member or an open invitation). The person who had access is told. */
export async function removeMember(storeId: string, actor: TeamActor, memberId: string, revision: number): Promise<{ removed: true }> {
  const current = await readMember(storeId, memberId);
  const deleted = (await StoreMember.findOneAndDelete({ _id: memberId, store: storeId, revision }).lean()) as unknown as Row | null;
  if (!deleted) throw memberChanged();
  await audit('team.remove', storeId, actor, { memberId, role: current.role, status: current.status });
  if (current.status !== 'invited') {
    const store = await storeFacts(storeId).catch(() => null);
    const name = String(current.email ?? '');
    if (store) {
      runAfterResponse('staff_access_removed', async () => {
        if (!databaseReady()) return;
        await enqueueEmail({
          template: 'staff_access_removed',
          to: name,
          vars: { storeName: store.name, memberName: name },
          dedupeKey: 'staff_access_removed:' + memberId,
        });
      });
    }
  }
  return { removed: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The invitee: look at an invite, accept it

/** What the accept page may show to a person holding a VALID token; anything else is { valid: false } (one neutral answer). */
export async function inviteInfo(token: unknown, now: Date = new Date()): Promise<TeamInviteInfo> {
  if (!isRawTokenShape(token)) return { valid: false };
  const row = (await StoreMember.findOne({ tokenHash: hashAuthToken(token), status: 'invited', expiresAt: { $gt: now } })
    .select('store email role')
    .lean()) as unknown as Row | null;
  if (!row) return { valid: false };
  const store = (await Store.findById(String(row.store)).select('name').lean()) as unknown as Row | null;
  if (!store) return { valid: false };
  return { valid: true, storeName: String(store.name ?? ''), role: row.role, email: String(row.email) };
}

/**
 * The signed-in user accepts an invite. ONE compare-and-set on { tokenHash, status invited, not expired, email = the signed-in account's email }: an unknown, expired,
 * used or other-account token matches nothing and is the same neutral 400 INVITE_INVALID, and a wrong-account attempt does not use the token up. The token is
 * cleared on success, so it works once. The owner is told. A person may be a member of several stores.
 */
export async function acceptInvite(actor: { userId: string; userObjectId: mongoose.Types.ObjectId }, token: unknown, now: Date = new Date()): Promise<TeamAcceptResponse> {
  if (!isRawTokenShape(token)) throw invalidInvite();
  const account = (await User.findById(actor.userObjectId).select('email').lean()) as unknown as Row | null;
  const email = typeof account?.email === 'string' ? account.email.trim().toLowerCase() : '';
  if (email === '') throw invalidInvite();

  let row: Row | null;
  try {
    row = (await StoreMember.findOneAndUpdate(
      { tokenHash: hashAuthToken(token), status: 'invited', expiresAt: { $gt: now }, email },
      { $set: { status: 'active', user: actor.userObjectId, acceptedAt: now }, $unset: { tokenHash: 1, expiresAt: 1 }, $inc: { revision: 1 } },
      { new: true },
    ).lean()) as unknown as Row | null;
  } catch (err) {
    // Already a member of this store through another row: the unique {store, user} index. Same neutral answer.
    if (isDuplicateKeyError(err)) throw invalidInvite();
    throw err;
  }
  if (!row) throw invalidInvite();

  const store = (await Store.findById(String(row.store)).select('name owner').lean()) as unknown as Row | null;
  if (!store) throw invalidInvite();
  const storeId = String(row.store);
  await audit('team.accept', storeId, { userId: actor.userId, userObjectId: actor.userObjectId, role: String(row.role) }, { memberId: String(row._id), role: row.role });
  runAfterResponse('staff_invite_accepted', async () => {
    if (!databaseReady()) return;
    const owner = store.owner ? ((await User.findById(String(store.owner)).select('email').lean()) as unknown as Row | null) : null;
    if (typeof owner?.email !== 'string') return;
    await enqueueEmail({
      template: 'staff_invite_accepted',
      to: owner.email,
      vars: {
        storeName: String(store.name ?? ''),
        memberName: String(row!.email),
        memberRole: ROLE_LABELS[String(row!.role)] ?? String(row!.role),
        dashboardLink: sellerDashboardLink(storeId, '/team') ?? 'your Markazify dashboard',
      },
      dedupeKey: 'staff_invite_accepted:' + String(row!._id),
    });
  });
  return { storeId, storeName: String(store.name ?? ''), role: row.role };
}

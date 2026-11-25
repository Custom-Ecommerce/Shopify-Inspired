/* patch_orders_fix: store scoping + order helpers shared by the orders / stores routes */
import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import { HttpError } from '@/lib/http';
import type { AuthContext } from '@/lib/auth';
import type { SellerCapability, SellerRole } from '@markaz/auth';
import { TEAM_ERROR_CODES } from '@/lib/contracts';
import { isStaffRole, sellerCan, Store, StoreMember } from '@/lib/services';
import { storeEqualsOf, type FieldKind } from '@/lib/where';

/** The code of a request that must name its store and did not (CO-72). */
export const STORE_ID_REQUIRED = 'STORE_ID_REQUIRED';

/** Order fields a dashboard filter may use. */
export const ORDER_FIELDS: Record<string, FieldKind> = {
  orderId: 'string',
  status: 'string',
  paymentMethod: 'string',
  customerName: 'string',
  phone: 'string',
  city: 'string',
  total: 'number',
  subtotal: 'number',
  createdAt: 'date',
  updatedAt: 'date',
};

export const ORDER_SORT_FIELDS = ['createdAt', 'updatedAt', 'total', 'status', 'orderId'] as const;

/** An order as the dashboard receives it: id instead of _id, no internal bookkeeping. */
export function publicOrder(row: Record<string, unknown>): Record<string, unknown> {
  const { _id, __v, idempotencyKey, requestFingerprint, ...rest } = row;
  void __v;
  void idempotencyKey;
  void requestFingerprint;
  return { id: String(_id), ...rest };
}

/**
 * Sprint 8 (S8-B2, D-118): who the signed-in user is in the store a request is about. role is null for an admin session (an admin is not a member of anything).
 */
export interface StoreAccess {
  storeId: string;
  role: SellerRole | null;
  isOwner: boolean;
}

export interface StoreAccessOptions {
  requireStore?: boolean;
  /**
   * The capability this route needs (packages/auth seller-capabilities). A route WITHOUT one is owner-only for now: an active member is refused with 403
   * NOT_OWNER_YET, so no route gains a member before it was swept (S8-B3 adds a capability to each route). With one, the owner passes it and a member passes it only
   * when their role has it (else 403 CAPABILITY_DENIED).
   */
  capability?: SellerCapability;
}

/** The part of a member row the access check reads. */
export interface MemberAccessRow {
  role?: unknown;
}

export type MembershipLoader = (storeId: string, userId: string) => Promise<MemberAccessRow | null>;
let membershipLoader: MembershipLoader | null = null;

/** Test seam: replaces the database read of the member row (null puts the real one back). */
export function setMembershipLoader(loader: MembershipLoader | null): void {
  membershipLoader = loader;
}

/**
 * Whether a member row can be looked up now: a loader was installed, or the database connection is open. A route has always connected first; the unit tests
 * of other routes stub the connection and never open one, and there a non-owner is simply a stranger (403, as before) instead of waiting on a buffered command.
 * It fails closed: no lookup means no member.
 */
function canLookUpMembers(): boolean {
  return membershipLoader !== null || mongoose.connection.readyState === 1;
}

/** The ACTIVE member row of this user in this store, read from the database on every call (never from the session cache, D-093). */
async function activeMember(storeId: string, ctx: AuthContext): Promise<MemberAccessRow | null> {
  if (!canLookUpMembers()) return null;
  try {
    if (membershipLoader !== null) return await membershipLoader(storeId, ctx.userId);
    return (await StoreMember.findOne({ store: storeId, user: ctx.userObjectId, status: 'active' }).select('role').lean()) as unknown as MemberAccessRow | null;
  } catch {
    // Fail closed: a lookup that cannot be answered is no membership. (An owner never gets here: Store.exists above already answered for them.)
    return null;
  }
}

export interface MembershipListRow {
  store: unknown;
  role: unknown;
}
export type MembershipListLoader = (userId: string) => Promise<MembershipListRow[]>;
let membershipListLoader: MembershipListLoader | null = null;

/** Test seam: replaces the database read of a user's active memberships (null puts the real one back). */
export function setMembershipListLoader(loader: MembershipListLoader | null): void {
  membershipListLoader = loader;
}

/**
 * The stores where this user is an ACTIVE member, with their role (an invited, disabled or removed member is in none). Read from the database on every call. Rows whose
 * role is not a staff role are left out (fail closed). Where the database cannot be asked (a unit test with no connection) the answer is none.
 */
export async function listActiveMemberships(ctx: AuthContext): Promise<Array<{ storeId: string; role: SellerRole }>> {
  if (ctx.actor !== 'seller' || (membershipListLoader === null && mongoose.connection.readyState !== 1)) return [];
  try {
    const rows = membershipListLoader !== null
      ? await membershipListLoader(ctx.userId)
      : ((await StoreMember.find({ user: ctx.userObjectId, status: 'active' }).select('store role').sort({ createdAt: 1 }).lean()) as unknown as MembershipListRow[]);
    return rows.filter((row) => isStaffRole(row.role)).map((row) => ({ storeId: String(row.store), role: row.role as SellerRole }));
  } catch {
    return [];
  }
}

const notYours = (): HttpError => new HttpError(403, 'Store does not belong to this account');

/**
 * The store this request is about, and the role of the signed-in user in it: { storeId, role, isOwner }.
 * Order of precedence: x-store-id header, then { store: { equals } } in ?where=, then the seller's
 * first owned store. A store the seller neither owns nor is an ACTIVE member of is refused with 403 (admins may name any store); an invited, disabled or
 * removed member is a stranger, with the same answer. A foreign store id stays 403 and a foreign record id stays 404 in the routes.
 *
 * CO-72 (Sprint 6): the last step, the silent fall back to the seller's FIRST store, is a hazard for a seller with several stores: a request
 * that forgot to say which store would act on the oldest one (and, with plan limits, count against it). A route that WRITES or COUNTS says
 * so with `{ requireStore: true }`: no store named is then 400 STORE_ID_REQUIRED and nothing is read. The other routes keep the fallback, which
 * is documented and tested as intended for them (the BFF always sends x-store-id; see the Sprint 6 report for the list). The fallback is the OWNED stores only.
 */
export async function resolveStoreAccess(
  request: NextRequest,
  ctx: AuthContext,
  where: Record<string, unknown> | null,
  options: StoreAccessOptions = {},
): Promise<StoreAccess> {
  const header = request.headers.get('x-store-id')?.trim() ?? '';
  const fromWhere = storeEqualsOf(where) ?? '';
  if (header !== '' && fromWhere !== '' && header !== fromWhere) throw new HttpError(403, 'Store mismatch');

  const candidate = header !== '' ? header : fromWhere;
  if (candidate === '') {
    if (options.requireStore === true) throw new HttpError(400, 'Say which store this is about (the x-store-id header).', STORE_ID_REQUIRED, 'x-store-id');
    if (ctx.actor !== 'seller') throw new HttpError(400, 'A store is required');
    const first = (await Store.findOne({ owner: ctx.userObjectId }).sort({ createdAt: 1 }).select('_id').lean()) as unknown as { _id: unknown } | null;
    if (!first) throw new HttpError(404, 'No store is linked to this account');
    return ownerAccess(String(first._id), ctx, options);
  }

  if (!mongoose.isValidObjectId(candidate)) throw notYours();
  if (ctx.actor !== 'seller') {
    ctx.storeRole = null;
    return { storeId: candidate, role: null, isOwner: false };
  }

  const owned = await Store.exists({ _id: candidate, owner: ctx.userObjectId });
  if (owned) return ownerAccess(candidate, ctx, options);

  const member = await activeMember(candidate, ctx);
  if (!member) throw notYours();
  // A row whose role is not a staff role (a corrupt row, or an "owner" row, which never exists) is no member at all: fail closed.
  const role = isStaffRole(member.role) ? (member.role as SellerRole) : null;
  if (role === null) throw notYours();
  if (options.capability === undefined) {
    throw new HttpError(403, 'This area is only available to the store owner for now.', TEAM_ERROR_CODES.NOT_OWNER_YET);
  }
  if (!sellerCan(role, options.capability)) {
    throw new HttpError(403, 'Your role in this store cannot do that.', TEAM_ERROR_CODES.CAPABILITY_DENIED);
  }
  ctx.storeRole = role;
  return { storeId: candidate, role, isOwner: false };
}

/** The owner passes any capability that exists; a capability this code does not know is denied even to the owner (a typo must not pass). */
function ownerAccess(storeId: string, ctx: AuthContext, options: StoreAccessOptions): StoreAccess {
  if (options.capability !== undefined && !sellerCan('owner', options.capability)) {
    throw new HttpError(403, 'Your role in this store cannot do that.', TEAM_ERROR_CODES.CAPABILITY_DENIED);
  }
  ctx.storeRole = 'owner';
  return { storeId, role: 'owner', isOwner: true };
}

/**
 * The same check, answering the store id alone (the shape of the ~51 callers from before Sprint 8). Everything above applies: an owner is unchanged, and a member is
 * refused unless the route names a capability the member's role has.
 */
export async function resolveOwnedStoreId(
  request: NextRequest,
  ctx: AuthContext,
  where: Record<string, unknown> | null,
  options: StoreAccessOptions = {},
): Promise<string> {
  return (await resolveStoreAccess(request, ctx, where, options)).storeId;
}

import { z } from 'zod';
import { objectIdSchema } from './object-id';

/*
 * Sprint 8 (S8-B2, D-118): a store's team. Staff roles, invites and the routes that manage them. Every body is strict; the routes are owner-only
 * (capability team.manage). The roles mirror STAFF_ROLES in @markaz/auth (this package does not depend on it).
 */

export const TEAM_ROLES = ['manager', 'staff', 'support'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** A member of the list: the owner of a store is not one of them. */
export const TEAM_MEMBER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type TeamMemberStatus = (typeof TEAM_MEMBER_STATUSES)[number];

/** What the store's owner sees as the role of the signed-in user in each store (the workspace list). */
export const STORE_ACCESS_ROLES = ['owner', 'manager', 'staff', 'support'] as const;
export type StoreAccessRole = (typeof STORE_ACCESS_ROLES)[number];

export const TEAM_INVITE_TTL_DAYS = 7;

export const TEAM_ERROR_CODES = {
  /** The one answer for a token that is unknown, expired, used, for another account, or for a store that is gone: a guess learns nothing. */
  INVITE_INVALID: 'INVITE_INVALID',
  INVITE_EXISTS: 'INVITE_EXISTS',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  OWNER_EMAIL: 'OWNER_EMAIL',
  MEMBER_CHANGED: 'MEMBER_CHANGED',
  MEMBER_STATE: 'MEMBER_STATE',
  /** A member reached a route that has no capability check yet (S8-B2): refused until the route is swept. */
  NOT_OWNER_YET: 'NOT_OWNER_YET',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
} as const;
export type TeamErrorCode = (typeof TEAM_ERROR_CODES)[keyof typeof TEAM_ERROR_CODES];

export const INVITE_INVALID_MESSAGE = 'This invitation is not valid. It may have expired or been used already. Ask the store owner to send a new one.';

const email = z
  .string({ error: 'enter an email address' })
  .trim()
  .toLowerCase()
  .min(5, 'enter an email address')
  .max(254, 'the email address is too long')
  .regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/, 'enter a valid email address');

const revision = z.number({ error: 'revision must be a number' }).int('revision must be a whole number').min(0, 'revision cannot be negative');

const role = z.enum(TEAM_ROLES, { error: 'choose manager, staff or support' });

/** POST /api/stores/:id/team/invite */
export const teamInviteRequestSchema = z.object({ email, role }).strict();

/** PATCH /api/stores/:id/team/:memberId — a role change, compare-and-set on revision. */
export const teamRoleChangeRequestSchema = z.object({ role, revision }).strict();

/** POST .../:memberId/resend | disable | enable | remove — the revision that was read. */
export const teamMemberActionRequestSchema = z.object({ revision }).strict();

/** POST /api/team/accept — the token of the link. The store is in the invite, not in the body (the portal does not bind a store here). */
export const teamAcceptRequestSchema = z.object({ token: z.string({ error: 'token is required' }).min(20).max(200) }).strict();

/** GET /api/team/invite?token=... — what the accept page may show a person holding a valid token. */
export const teamInviteInfoQuerySchema = z.object({ token: z.string().min(20).max(200) }).strict();

export const teamMemberSchema = z.object({
  id: objectIdSchema,
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(TEAM_ROLES),
  status: z.enum(TEAM_MEMBER_STATUSES),
  invitedAt: z.string(),
  /** The end of an open invite; null once it was accepted. */
  inviteExpiresAt: z.string().nullable(),
  /** True for an invite whose link has stopped working (resend makes a new one). */
  inviteExpired: z.boolean(),
  acceptedAt: z.string().nullable(),
  revision: z.number().int().min(0),
});
export type TeamMember = z.output<typeof teamMemberSchema>;

export const teamListResponseSchema = z.object({
  members: z.array(teamMemberSchema),
  /** Seats in use (invited and active) against the plan; limit null is unlimited. */
  seats: z.object({ used: z.number().int().min(0), limit: z.number().int().min(0).nullable() }),
});
export type TeamListResponse = z.output<typeof teamListResponseSchema>;

export const teamMemberResponseSchema = z.object({ member: teamMemberSchema });
export type TeamMemberResponse = z.output<typeof teamMemberResponseSchema>;

export const teamInviteInfoSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(true), storeName: z.string(), role: z.enum(TEAM_ROLES), email: z.string() }),
  z.object({ valid: z.literal(false) }),
]);
export type TeamInviteInfo = z.output<typeof teamInviteInfoSchema>;

export const teamAcceptResponseSchema = z.object({ storeId: objectIdSchema, storeName: z.string(), role: z.enum(TEAM_ROLES) });
export type TeamAcceptResponse = z.output<typeof teamAcceptResponseSchema>;

/** One store of the signed-in user and the role they hold in it (the workspace list). */
export const storeAccessSchema = z.object({ id: objectIdSchema, role: z.enum(STORE_ACCESS_ROLES) });
export type StoreAccess = z.output<typeof storeAccessSchema>;

export type TeamInviteRequest = z.output<typeof teamInviteRequestSchema>;
export type TeamRoleChangeRequest = z.output<typeof teamRoleChangeRequestSchema>;
export type TeamMemberActionRequest = z.output<typeof teamMemberActionRequestSchema>;
export type TeamAcceptRequest = z.output<typeof teamAcceptRequestSchema>;

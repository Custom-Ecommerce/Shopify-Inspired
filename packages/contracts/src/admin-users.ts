import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Sprint 6 EP-20 (S6-B6, D-118): admin users and levels. Strict objects, one named field per problem. The levels are the ones of
 * packages/auth/src/admin-levels.ts (kept equal by a test).
 */

export const ADMIN_LEVEL_VALUES = ['owner', 'finance', 'operations', 'customer_support'] as const;
export const adminLevelSchema = z.enum(ADMIN_LEVEL_VALUES, { error: 'Choose owner, finance, operations or customer support.' });
export const ADMIN_USER_REASON_MIN = 3;
export const ADMIN_USER_REASON_MAX = 300;

const isoDate = z.string().datetime({ offset: true });
const reason = z
  .string({ error: 'Give a reason.' })
  .trim()
  .min(ADMIN_USER_REASON_MIN, 'Give a reason of at least ' + ADMIN_USER_REASON_MIN + ' characters.')
  .max(ADMIN_USER_REASON_MAX, 'The reason can be at most ' + ADMIN_USER_REASON_MAX + ' characters.')
  .refine((value) => !/[<>]/.test(value), 'Use plain text: < and > are not allowed.');

export const inviteAdminRequestSchema = z
  .object({
    name: z.string({ error: 'Enter a name.' }).trim().min(1, 'Enter a name.').max(80, 'The name can be at most 80 characters.').refine((v) => !/[<>]/.test(v), 'Use plain text: < and > are not allowed.'),
    email: z.string({ error: 'Enter an email address.' }).trim().toLowerCase().max(254).regex(/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/, 'Enter a valid email address.'),
    adminLevel: adminLevelSchema,
  })
  .strict();

export const acceptInviteRequestSchema = z
  .object({ token: z.string({ error: 'The link is not complete.' }).min(16).max(200), password: z.string({ error: 'Choose a password.' }).min(8, 'The password must be at least 8 characters.').max(200) })
  .strict();

export const changeLevelRequestSchema = z.object({ adminLevel: adminLevelSchema, reason }).strict();
export const setAdminStatusRequestSchema = z.object({ reason }).strict();

export const adminUserSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  email: z.string(),
  adminLevel: adminLevelSchema,
  accountStatus: z.enum(['active', 'suspended', 'blocked']),
  /** True once the invited person has set a password. */
  accepted: z.boolean(),
  createdAt: isoDate,
});
export type AdminUser = z.output<typeof adminUserSchema>;
export const adminUserListSchema = z.object({ users: z.array(adminUserSchema) });
export const adminUserResponseSchema = z.object({ user: adminUserSchema });

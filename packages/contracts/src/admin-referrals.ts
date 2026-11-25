import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { REFERRAL_STATUSES } from './referral';

/*
 * Sprint 8 (S8-B6, D-118): the admin console's READ-ONLY view of referrals and the CSV of rewards. Owner and finance (capability referrals.read). The
 * referred seller is a masked name only. The rows live in the seller database, so each read is one signed call to the seller backend.
 */

export const ADMIN_REFERRAL_EXPORT_CAP = 5000;
export const ADMIN_REFERRAL_PAGE_SIZE = 20;
export const ADMIN_REFERRAL_PAGE_MAX = 50;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use a date like 2026-11-20');

/** POST /api/internal/referrals: the filters of the list. from and to are UTC days of the sign-up, both included. */
export const adminReferralListQuerySchema = z.strictObject({
  status: z.enum(REFERRAL_STATUSES).optional(),
  /** Part of the referrer's name or email. */
  q: z.string().trim().min(1).max(100).optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.number().int().min(1).max(10000).default(1),
  limit: z.number().int().min(1).max(ADMIN_REFERRAL_PAGE_MAX).default(ADMIN_REFERRAL_PAGE_SIZE),
});
export type AdminReferralListQuery = z.output<typeof adminReferralListQuerySchema>;

/** POST /api/internal/referrals/export: from and to are UTC days of the reward. */
export const adminReferralExportQuerySchema = z.strictObject({ from: day.optional(), to: day.optional() });
export type AdminReferralExportQuery = z.output<typeof adminReferralExportQuerySchema>;

export const adminReferralRowSchema = z.strictObject({
  id: objectIdSchema,
  referrer: z.strictObject({ id: objectIdSchema, name: z.string(), email: z.string() }),
  /** The referred seller's name, masked. */
  referred: z.string(),
  status: z.enum(REFERRAL_STATUSES),
  months: z.number().int().min(0),
  createdAt: z.string(),
  rewardedAt: z.string().nullable(),
  /** Set when the payment that earned the reward was voided afterwards: the owner decides by hand. */
  paymentVoidedAt: z.string().nullable(),
});
export type AdminReferralRow = z.output<typeof adminReferralRowSchema>;

export const adminReferralListSchema = z.object({
  docs: z.array(adminReferralRowSchema),
  page: z.number().int(),
  limit: z.number().int(),
  totalDocs: z.number().int(),
  totalPages: z.number().int(),
});
export type AdminReferralList = z.output<typeof adminReferralListSchema>;

export const adminReferralExportSchema = z.object({ rows: z.array(adminReferralRowSchema), truncated: z.boolean() });
export type AdminReferralExport = z.output<typeof adminReferralExportSchema>;

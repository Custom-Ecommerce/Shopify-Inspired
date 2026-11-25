import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** Referral statuses and reward types, as apps/admin/src/collections/Referrals.ts defines them. */
export const REFERRAL_STATUSES = ['pending', 'rewarded'] as const;
export const REFERRAL_REWARD_TYPES = ['commission_discount', 'platform_credit'] as const;

const isoDate = z.string().datetime({ offset: true });

/** A referral as the referrer's dashboard reads it. The reward fields are set by admins. */
export const referralSchema = z.object({
  id: objectIdSchema,
  referrer: objectIdSchema,
  referred: objectIdSchema,
  status: z.enum(REFERRAL_STATUSES),
  rewardType: z.enum(REFERRAL_REWARD_TYPES).nullable().optional(),
  rewardValue: z.number().nullable().optional(),
  rewardedAt: isoDate.nullable().optional(),
  monthsRewarded: z.number().int().min(0).optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type Referral = z.infer<typeof referralSchema>;

/*
 * Sprint 8 (S8-B5, D-118): the seller's referral code and what they see of their referrals. One code per SELLER (not per store). The referred seller sees none of
 * this; the referrer sees a masked name and never the email.
 */

/** No 0, O, 1, I or L: a code can be read aloud and typed. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;
const CODE_SHAPE = new RegExp('^[' + REFERRAL_CODE_ALPHABET + ']{' + REFERRAL_CODE_LENGTH + '}$');

/** A code as stored (upper case), or null for anything that cannot be one. Never throws. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const code = value.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}

/** One referral as the referrer sees it. Strict: an email or an id of the referred seller added by mistake fails the parse. */
export const referralRowSchema = z.strictObject({
  id: objectIdSchema,
  /** The referred seller's name, masked, for example "S*** K.". */
  name: z.string(),
  status: z.enum(REFERRAL_STATUSES),
  monthsRewarded: z.number().int().min(0),
  createdAt: isoDate,
  rewardedAt: isoDate.nullable(),
});
export type ReferralRow = z.infer<typeof referralRowSchema>;

/** GET /api/referrals */
export const referralOverviewSchema = z.strictObject({
  code: z.string(),
  /** The signup link with the code; null when the portal address is not configured. */
  shareLink: z.string().nullable(),
  /** False when the platform has turned referrals off (referralRewardMonths 0): new sign-ups are not counted. */
  enabled: z.boolean(),
  rewardMonths: z.number().int().min(0),
  monthlyCap: z.number().int().min(0),
  totals: z.strictObject({
    referred: z.number().int().min(0),
    pending: z.number().int().min(0),
    rewarded: z.number().int().min(0),
    monthsEarned: z.number().int().min(0),
  }),
  referrals: z.array(referralRowSchema),
});
export type ReferralOverview = z.infer<typeof referralOverviewSchema>;

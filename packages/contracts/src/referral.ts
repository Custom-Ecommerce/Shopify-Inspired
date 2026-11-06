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
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type Referral = z.infer<typeof referralSchema>;

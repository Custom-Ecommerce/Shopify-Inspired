import { z } from 'zod';
import { objectIdSchema } from './object-id';

/** POST /api/stores/:id/billing/onboard. The body storeId must equal the path store id. */
export const stripeOnboardRequestSchema = z.object({
  storeId: objectIdSchema,
});

/** Stripe account-onboarding link. expiresAt is the Unix time Stripe returns, in seconds. */
export const stripeOnboardResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: z.number().int().nullable().optional(),
});

export type StripeOnboardRequest = z.infer<typeof stripeOnboardRequestSchema>;
export type StripeOnboardResponse = z.infer<typeof stripeOnboardResponseSchema>;

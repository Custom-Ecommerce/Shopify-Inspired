import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { CUSTOM_DOMAIN_STATUSES } from './store';

const hostname = z.string().min(3).max(253);

/** POST /api/stores/:id/domain/connect. The store id comes from the path; a body storeId must match it. */
export const domainConnectRequestSchema = z.object({
  domain: hostname,
  storeId: objectIdSchema.optional(),
});

/** POST /api/stores/:id/domain/verify. Both fields are optional; the path names the store. */
export const domainVerifyRequestSchema = z.object({
  domain: hostname.optional(),
  storeId: objectIdSchema.optional(),
});

export const domainStatusResponseSchema = z.object({
  domain: hostname,
  customDomainStatus: z.enum(CUSTOM_DOMAIN_STATUSES),
});

export type DomainConnectRequest = z.infer<typeof domainConnectRequestSchema>;
export type DomainVerifyRequest = z.infer<typeof domainVerifyRequestSchema>;
export type DomainStatusResponse = z.infer<typeof domainStatusResponseSchema>;

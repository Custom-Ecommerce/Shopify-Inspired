import { z } from 'zod';
import { CUSTOM_DOMAIN_STATUSES } from './store';

const hostname = z.string().min(3).max(253);

/** POST /api/stores/:id/domain/connect. The store comes from the path. Strict: no other field is accepted. */
export const domainConnectRequestSchema = z.object({ domain: hostname }).strict();

/** POST /api/stores/:id/domain/verify. The body is empty: the result of a check is never taken from the client. */
export const domainVerifyRequestSchema = z.object({}).strict();

export const DOMAIN_RECORD_TYPES = ['CNAME', 'A', 'TXT'] as const;
export const DOMAIN_FAILURE_REASONS = ['token_missing', 'target_wrong', 'dns_error', 'dns_timeout', 'vercel_failed'] as const;

export const domainRecordSchema = z.object({
  type: z.enum(DOMAIN_RECORD_TYPES),
  name: z.string(),
  value: z.string(),
});

/** What the seller's domain page reads: the answer of GET domain, connect, verify and disconnect. */
export const domainStateResponseSchema = z.object({
  domain: z.string().nullable(),
  customDomainStatus: z.enum(CUSTOM_DOMAIN_STATUSES),
  dnsRecords: z.array(domainRecordSchema),
  failureReason: z.enum(DOMAIN_FAILURE_REASONS).nullable(),
  failureMessage: z.string().nullable(),
  checkedAt: z.string().nullable(),
  vercelConfigured: z.boolean(),
  planAllowsCustomDomain: z.boolean(),
  /** S7-B6: redirect the platform address to the verified domain (OFF by default). Optional so an older backend still parses. */
  redirectToCustomDomain: z.boolean().optional(),
});

export type DomainConnectRequest = z.infer<typeof domainConnectRequestSchema>;
export type DomainVerifyRequest = z.infer<typeof domainVerifyRequestSchema>;
export type DomainRecord = z.infer<typeof domainRecordSchema>;
export type DomainStateResponse = z.infer<typeof domainStateResponseSchema>;

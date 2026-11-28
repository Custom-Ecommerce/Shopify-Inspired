import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Sprint 6 (S6-B7): retries of dead sync events and failed emails, and the retention run. Strict objects. Retries are capped at 100 per call. A failed email
 * row NEVER carries its payload or body: only the kind, a masked recipient, the attempts, an error code and dates.
 */

export const RETRY_CAP = 100;
const isoDate = z.string().datetime({ offset: true });

export const retryRequestSchema = z
  .object({ ids: z.array(objectIdSchema).min(1, 'Choose at least one.').max(RETRY_CAP, 'Retry at most ' + RETRY_CAP + ' at a time.') })
  .strict()
  .refine((body) => new Set(body.ids).size === body.ids.length, { message: 'Each id can be listed once.', path: ['ids'] });
export const retryResponseSchema = z.object({ requested: z.number().int().min(0), retried: z.number().int().min(0), skipped: z.number().int().min(0) });

export const failedEmailRowSchema = z
  .object({
    id: objectIdSchema,
    kind: z.string(),
    recipient: z.string(),
    attempts: z.number().int().min(0),
    errorCode: z.string().nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export const failedEmailListSchema = z.object({ docs: z.array(failedEmailRowSchema), totalDocs: z.number().int().min(0) });
export type FailedEmailRow = z.output<typeof failedEmailRowSchema>;

export const RETENTION_TARGET_KEYS = ['notification_outbox', 'sync_outbox', 'stock_movements', 'product_trash', 'contact_messages', 'closed_tickets', 'mobile_devices'] as const;
export const retentionRunRequestSchema = z.object({ apply: z.boolean().optional() }).strict();
export const retentionRunResponseSchema = z.object({
  dryRun: z.boolean(),
  targets: z.array(z.object({ key: z.enum(RETENTION_TARGET_KEYS), days: z.number().int().min(1), eligible: z.number().int().min(0), purged: z.number().int().min(0), more: z.boolean() })),
  at: isoDate,
});
export type RetentionRunResponse = z.output<typeof retentionRunResponseSchema>;

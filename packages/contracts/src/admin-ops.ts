import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { STORE_STATUSES } from './store';

/**
 * Wire shapes of the admin console's operations endpoints (apps/admin-portal): sellers, the sync outbox, and the
 * audit log. Identity is id. Every list uses the same envelope fields as the store list.
 */

const isoDate = z.string().datetime({ offset: true });

function envelopeOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    docs: z.array(item),
    totalDocs: z.number().int().min(0),
    totalPages: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
  });
}

/* Sellers: accounts with the seller role, with the stores they own. */

export const adminSellerStoreSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  status: z.enum(STORE_STATUSES),
});

export const adminSellerListItemSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  email: z.string(),
  /** A short preview of the seller's stores, newest first. storeCount is the full number. */
  stores: z.array(adminSellerStoreSchema),
  storeCount: z.number().int().min(0),
  createdAt: isoDate,
});

export const adminSellerListEnvelopeSchema = envelopeOf(adminSellerListItemSchema);

/* Sync outbox health. */

export const ADMIN_SYNC_STATUSES = ['pending', 'sent', 'dead'] as const;
export const ADMIN_SYNC_TARGETS = ['admin', 'seller'] as const;

export const adminSyncEventSchema = z.object({
  id: objectIdSchema,
  eventId: z.string(),
  target: z.enum(ADMIN_SYNC_TARGETS),
  entity: z.string(),
  entityId: z.string(),
  group: z.string(),
  revision: z.number().int().min(0),
  status: z.enum(ADMIN_SYNC_STATUSES),
  attempts: z.number().int().min(0),
  nextAttemptAt: isoDate.nullable(),
  lastError: z.string().nullable(),
  sentAt: isoDate.nullable(),
  createdAt: isoDate,
});

export const adminSyncOutboxSchema = z.object({
  counts: z.object({
    pending: z.number().int().min(0),
    sent: z.number().int().min(0),
    dead: z.number().int().min(0),
  }),
  oldestPendingAt: isoDate.nullable(),
  lastSentAt: isoDate.nullable(),
  /** The status the event list is filtered to. Dead letters by default. */
  status: z.enum(ADMIN_SYNC_STATUSES),
  events: envelopeOf(adminSyncEventSchema),
});

/* Audit log. */

export const adminAuditEntrySchema = z.object({
  id: objectIdSchema,
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  actor: z.object({ id: z.string(), name: z.string().nullable() }),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  createdAt: isoDate,
});

export const adminAuditListSchema = envelopeOf(adminAuditEntrySchema).extend({
  /** The actions present in the log, for the filter. */
  facets: z.object({ actions: z.array(z.string()) }),
});

export type AdminSellerStore = z.infer<typeof adminSellerStoreSchema>;
export type AdminSellerListItem = z.infer<typeof adminSellerListItemSchema>;
export type AdminSellerListEnvelope = z.infer<typeof adminSellerListEnvelopeSchema>;
export type AdminSyncEvent = z.infer<typeof adminSyncEventSchema>;
export type AdminSyncOutbox = z.infer<typeof adminSyncOutboxSchema>;
export type AdminSyncStatus = (typeof ADMIN_SYNC_STATUSES)[number];
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;
export type AdminAuditList = z.infer<typeof adminAuditListSchema>;

import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { COMMISSION_MODES, CUSTOM_DOMAIN_STATUSES, STORE_STATUSES } from './store';

/** Wire shapes of the admin console's store endpoints (apps/admin-portal, /api/admin/stores). Identity is `id`. */

const isoDate = z.string().datetime({ offset: true });

/** The statuses an operator can set. A store is never put into pending or archived from the console. */
export const GOVERNANCE_STATUSES = ['active', 'suspended'] as const;
export const GOVERNANCE_REASON_MIN = 3;
export const GOVERNANCE_REASON_MAX = 500;
export const GOVERNANCE_NOTE_MAX = 1000;

export const adminStoreListItemSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(STORE_STATUSES),
  domain: z.string().nullable(),
  isThemeDemo: z.boolean(),
  commissionRate: z.number().finite().min(0),
  commissionMode: z.enum(COMMISSION_MODES),
  owner: z.object({ id: objectIdSchema, name: z.string(), email: z.string() }).nullable(),
  statusChangedAt: isoDate.nullable(),
  createdAt: isoDate,
});

export const adminStoreOwnerSchema = z.object({ id: objectIdSchema, name: z.string(), email: z.string() });

export const adminStoreAuditEntrySchema = z.object({
  id: objectIdSchema,
  action: z.string(),
  actor: z.object({ id: z.string(), name: z.string().nullable() }),
  reason: z.string().nullable(),
  note: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  createdAt: isoDate,
});

export const adminStoreDetailSchema = adminStoreListItemSchema.extend({
  internalHandle: z.string().nullable(),
  customDomainStatus: z.enum(CUSTOM_DOMAIN_STATUSES),
  suspensionReason: z.string().nullable(),
  suspensionNote: z.string().nullable(),
  suspendedAt: isoDate.nullable(),
  archivedAt: isoDate.nullable(),
  govRevision: z.number().int().min(0),
  opsRevision: z.number().int().min(0),
  activeTheme: z.string().nullable(),
  stripeOnboardingStatus: z.string().nullable(),
  stripeChargesEnabled: z.boolean().nullable(),
  updatedAt: isoDate,
  history: z.array(adminStoreAuditEntrySchema),
});

export const adminStoreListEnvelopeSchema = z.object({
  docs: z.array(adminStoreListItemSchema),
  totalDocs: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

/** The governance form. A reason is mandatory for both suspending and activating. */
export const storeStatusChangeRequestSchema = z.object({
  status: z.enum(GOVERNANCE_STATUSES),
  reason: z.string().trim().min(GOVERNANCE_REASON_MIN, 'a reason is required').max(GOVERNANCE_REASON_MAX),
  note: z.string().trim().max(GOVERNANCE_NOTE_MAX).optional(),
});

export const storeStatusChangeResponseSchema = z.object({
  store: z.object({
    id: objectIdSchema,
    status: z.enum(STORE_STATUSES),
    suspensionReason: z.string().nullable(),
    suspensionNote: z.string().nullable(),
    suspendedAt: isoDate.nullable(),
    statusChangedAt: isoDate.nullable(),
  }),
  queued: z.object({ eventId: z.string(), revision: z.number().int().min(1) }).nullable(),
});

export type AdminStoreListItem = z.infer<typeof adminStoreListItemSchema>;
export type AdminStoreDetail = z.infer<typeof adminStoreDetailSchema>;
export type AdminStoreAuditEntry = z.infer<typeof adminStoreAuditEntrySchema>;
export type AdminStoreListEnvelope = z.infer<typeof adminStoreListEnvelopeSchema>;
export type StoreStatusChangeRequest = z.infer<typeof storeStatusChangeRequestSchema>;
export type StoreStatusChangeResponse = z.infer<typeof storeStatusChangeResponseSchema>;
export type GovernanceStatus = (typeof GOVERNANCE_STATUSES)[number];

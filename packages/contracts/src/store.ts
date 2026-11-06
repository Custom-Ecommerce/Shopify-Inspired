import { z } from 'zod';
import { objectIdSchema } from './object-id';

// Enum sets copied from packages/db-schemas/src/models/store.ts. Keep them identical.
export const STORE_STATUSES = ['pending', 'active', 'suspended', 'archived'] as const;
export const CUSTOM_DOMAIN_STATUSES = ['unset', 'pending', 'verified', 'failed'] as const;
export const COMMISSION_MODES = ['inherit', 'custom'] as const;
export const PROVISIONING_STATES = ['provisioned', 'awaiting_seller_ack'] as const;

/** Mixed fields in the model: their inner shape is captured in B9.1. */
const mixed = z.record(z.string(), z.unknown());

/** A media relation as the store page reads it: the ObjectId, or the populated media (id, url). */
const mediaRelation = z.union([objectIdSchema, z.object({ id: objectIdSchema, url: z.string().nullable().optional() })]);

/**
 * The Store document as the B3 model defines it, field for field. _id is the Mongo id.
 * Required in the model: name, slug, status, commissionRate, govRevision, opsRevision.
 */
export const storeSchema = z.object({
  id: objectIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  internalHandle: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  customDomainStatus: z.enum(CUSTOM_DOMAIN_STATUSES).optional(),
  isThemeDemo: z.boolean().optional(),
  owner: objectIdSchema.nullable().optional(),
  status: z.enum(STORE_STATUSES),
  suspensionReason: z.string().nullable().optional(),
  suspensionNote: z.string().nullable().optional(),
  suspendedAt: z.string().datetime({ offset: true }).nullable().optional(),
  statusChangedAt: z.string().datetime({ offset: true }).nullable().optional(),
  commissionRate: z.number().finite().min(0),
  commissionMode: z.enum(COMMISSION_MODES).optional(),
  govRevision: z.number().int().min(0),
  opsRevision: z.number().int().min(0),
  archivedAt: z.string().datetime({ offset: true }).nullable().optional(),
  registrationId: z.string().nullable().optional(),
  provisioningState: z.enum(PROVISIONING_STATES).nullable().optional(),
  referralCode: z.string().nullable().optional(),
  referredBy: objectIdSchema.nullable().optional(),
  storefront: z
    .object({
      announcementText: z.string().nullable().optional(),
      whatsappNumber: z.string().nullable().optional(),
      deliveryRate: z.number().nullable().optional(),
      freeDeliveryThreshold: z.number().nullable().optional(),
      activeTheme: z.string().nullable().optional(),
      logo: mediaRelation.nullable().optional(),
      seoTitle: z.string().nullable().optional(),
      seoDescription: z.string().nullable().optional(),
      seoImage: mediaRelation.nullable().optional(),
    })
    .nullable()
    .optional(),
  courierSettings: mixed.nullable().optional(),
  paymentSettings: z
    .object({
      codEnabled: z.boolean().nullable().optional(),
      cardEnabled: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  billing: z
    .object({
      stripeOnboardingStatus: z.string().nullable().optional(),
      stripeChargesEnabled: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Store = z.infer<typeof storeSchema>;
export type StoreStatus = (typeof STORE_STATUSES)[number];

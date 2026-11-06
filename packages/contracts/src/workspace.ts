import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { STORE_STATUSES, CUSTOM_DOMAIN_STATUSES } from './store';

/** Shape the seller frontend declares in lib/types/dashboard.ts (WorkspaceStore, WorkspaceUser, ...). */
export const workspaceUserSchema = z.object({
  id: objectIdSchema,
  name: z.string().nullable().optional(),
  email: z.string().min(3),
  accountStatus: z.enum(['active', 'suspended']).nullable().optional(),
});

export const workspaceStoreSchema = z.object({
  id: objectIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  internalHandle: z.string().nullable().optional(),
  status: z.enum(STORE_STATUSES),
  suspensionReason: z.string().nullable().optional(),
  suspensionNote: z.string().nullable().optional(),
  suspendedAt: z.string().datetime({ offset: true }).nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  activeTheme: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  customDomainStatus: z.enum(CUSTOM_DOMAIN_STATUSES).nullable().optional(),
  billing: z
    .object({
      stripeOnboardingStatus: z.string().nullable().optional(),
      stripeChargesEnabled: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const workspaceLimitsSchema = z.object({
  used: z.number().int().min(0),
  max: z.number().int().min(0),
  canCreate: z.boolean(),
});

export const workspaceSchema = z.object({
  user: workspaceUserSchema,
  stores: z.array(workspaceStoreSchema),
  limits: workspaceLimitsSchema,
});

export type WorkspaceUser = z.infer<typeof workspaceUserSchema>;
export type WorkspaceStore = z.infer<typeof workspaceStoreSchema>;
export type WorkspaceLimits = z.infer<typeof workspaceLimitsSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;

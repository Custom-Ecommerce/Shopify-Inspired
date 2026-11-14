
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose';

export const PLATFORM_SETTINGS_GLOBAL_TYPE = 'platformSettings' as const;

/**
 * Mirrors the Payload platformSettings GLOBAL (apps/admin/src/globals/PlatformSettings.ts).
 *
 * Payload 3 stores every global in ONE collection named globals, discriminated by globalType
 * (verified against the reference database adapter, version 3.88.0).
 * This model is therefore a view on that shared collection. It is not a key/value table.
 * Read-only from this package: staff change defaults in the admin UI, and this code reads them.
 */
const platformSettingsSchema = new Schema(
  {
    globalType: { type: String, required: true },
    defaultCommissionRate: { type: Number, required: true, min: 0, max: 100, default: 4 },
    maxStoresPerSeller: { type: Number, min: 1, default: 3 },
    settingsRevision: { type: Number, default: 0 },
    stripeCommissionNote: { type: String },
    /** Sprint 4 D-094/D-095: when true, a seller's go-live waits for an admin to activate the store. Missing means false. */
    storeApprovalRequired: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'globals' },
);

export type PlatformSettingsDoc = InferSchemaType<typeof platformSettingsSchema>;

export const PlatformSettingsModel: Model<PlatformSettingsDoc> =
  (models.PlatformSettings as Model<PlatformSettingsDoc> | undefined) ??
  model<PlatformSettingsDoc>('PlatformSettings', platformSettingsSchema);

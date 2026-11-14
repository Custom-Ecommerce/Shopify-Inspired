
import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export const STORE_STATUSES = ['pending', 'active', 'suspended', 'archived'] as const;
export const CUSTOM_DOMAIN_STATUSES = ['unset', 'pending', 'verified', 'failed'] as const;
export const COMMISSION_MODES = ['inherit', 'custom'] as const;
export const PROVISIONING_STATES = ['provisioned', 'awaiting_seller_ack'] as const;

/**
* Mirrors the Payload Stores collection (apps/admin/src/collections/Stores.ts).
* Collection: stores. Both replicas hold this full document: governance fields are
* owned by the admin, operations fields by the seller (blueprint v3 section 1.2).
*
* Grouped fields (storefront, courierSettings, paymentSettings, billing) are Mixed
* until B1 captures their inner shapes. Relation targets for referredBy and the
* sparse-unique rules are to be confirmed in B1 against the captured indexes.
*/
export interface IStore extends Document {
name: string;
slug: string;
internalHandle?: string | null;
domain?: string | null;
customDomainStatus: (typeof CUSTOM_DOMAIN_STATUSES)[number];
isThemeDemo: boolean;
/** The demo category and product were seeded. Stays true after the seller deletes them, so they never come back. */
demoSeeded: boolean;
owner?: Types.ObjectId | null;
status: (typeof STORE_STATUSES)[number];
suspensionReason?: string | null;
suspensionNote?: string | null;
suspendedAt?: Date | null;
statusChangedAt?: Date | null;
commissionRate: number;
commissionMode: (typeof COMMISSION_MODES)[number];
govRevision: number;
opsRevision: number;
archivedAt?: Date | null;
registrationId?: string | null;
provisioningState?: (typeof PROVISIONING_STATES)[number] | null;
referralCode?: string | null;
referredBy?: Types.ObjectId | null;
storefront?: unknown;
courierSettings?: unknown;
paymentSettings?: unknown;
billing?: unknown;
/** Sprint 4 D-088: where the platform pays the seller. Never selected by default: read only to mask it or to pay out. */
payoutDetails?: unknown;
/** Sprint 4 D-095: when the seller asked to go live while approval is required (the admin then activates). */
goLiveRequestedAt?: Date | null;
createdAt: Date;
updatedAt: Date;
}

const StoreSchema = new Schema(
{
name: { type: String, required: true },
slug: { type: String, required: true, unique: true },
internalHandle: { type: String, unique: true, sparse: true },
domain: { type: String },
customDomainStatus: { type: String, enum: [...CUSTOM_DOMAIN_STATUSES], default: 'unset' },
isThemeDemo: { type: Boolean, default: false },
demoSeeded: { type: Boolean, default: false },
owner: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
status: { type: String, enum: [...STORE_STATUSES], required: true, default: 'pending' },
suspensionReason: { type: String },
suspensionNote: { type: String },
suspendedAt: { type: Date },
statusChangedAt: { type: Date },
commissionRate: { type: Number, required: true, default: 0, min: 0, max: 100 },
commissionMode: { type: String, enum: [...COMMISSION_MODES], default: 'inherit' },
govRevision: { type: Number, required: true, default: 0 },
opsRevision: { type: Number, required: true, default: 0 },
archivedAt: { type: Date },
registrationId: { type: String, unique: true, sparse: true },
provisioningState: { type: String, enum: [...PROVISIONING_STATES] },
referralCode: { type: String, unique: true, sparse: true },
referredBy: { type: Schema.Types.ObjectId, default: null },
storefront: { type: Schema.Types.Mixed },
courierSettings: { type: Schema.Types.Mixed },
paymentSettings: { type: Schema.Types.Mixed },
billing: { type: Schema.Types.Mixed },
payoutDetails: { type: Schema.Types.Mixed, select: false },
goLiveRequestedAt: { type: Date, default: null },
},
{ timestamps: true, collection: 'stores' },
);

// Custom-domain resolution (GET /api/storefront/v1/stores/by-key/:key?by=domain). Not unique: uniqueness
// is enforced when a domain is connected.
StoreSchema.index({ domain: 1 }, { sparse: true });

// The rates list and the stores list are newest first.
StoreSchema.index({ createdAt: -1, _id: -1 });

export const Store: Model<IStore> =
(mongoose.models.Store as Model<IStore> | undefined) ?? mongoose.model<IStore>('Store', StoreSchema, 'stores');

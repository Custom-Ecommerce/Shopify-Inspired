import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** The same values as API_KEY_SCOPES in @markaz/contracts (this package depends on mongoose only). */
export const API_KEY_MODEL_SCOPES = ['products:read', 'orders:read'] as const;
export const API_KEY_MODEL_NAME_MAX = 40;

/**
 * Collection: apikeys (Sprint 8, S8-B4, D-118). One row per API key of a store, for the read-only v1 API.
 *
 * A key reads "mkz_live_<prefix>_<secret>". Only `prefix` (the public part, shown to the owner) and `hash` (the SHA-256 hex of the secret, select:false) are
 * stored: the secret itself is NEVER stored, so a leaked database cannot be used to call the API. A revoked key keeps its row (revokedAt) for the owner's
 * records and holds no plan slot. revision is the compare-and-set counter.
 *
 * Indexes (declared here, planned by scripts/ensure-indexes.mjs):
 *   {prefix}            unique: a presented key finds at most one row
 *   {store, revokedAt}  the list of a store's keys and the count of its live ones
 */
export interface IApiKey {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  name: string;
  /** 8 lowercase hex characters: the public part of the key. */
  prefix: string;
  /** SHA-256 hex of the secret part. */
  hash: string;
  scopes: Array<(typeof API_KEY_MODEL_SCOPES)[number]>;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdBy: Types.ObjectId;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    name: { type: String, required: true, trim: true, maxlength: API_KEY_MODEL_NAME_MAX },
    prefix: { type: String, required: true, match: /^[0-9a-f]{8}$/ },
    hash: { type: String, required: true, select: false, match: /^[0-9a-f]{64}$/ },
    scopes: {
      type: [{ type: String, enum: [...API_KEY_MODEL_SCOPES] }],
      required: true,
      validate: { validator: (value: unknown[]) => Array.isArray(value) && value.length >= 1 && new Set(value).size === value.length, message: 'choose at least one scope, each once' },
    },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revision: { type: Number, default: 0, min: 0 },
  },
  // bufferCommands off, as the seller backend connects.
  { timestamps: true, collection: 'apikeys', bufferCommands: false },
);

ApiKeySchema.index({ prefix: 1 }, { unique: true, name: 'prefix_unique' });
ApiKeySchema.index({ store: 1, revokedAt: 1 }, { name: 'store_revokedAt' });

export const ApiKey: Model<IApiKey> = (mongoose.models.ApiKey as Model<IApiKey> | undefined) ?? mongoose.model<IApiKey>('ApiKey', ApiKeySchema);

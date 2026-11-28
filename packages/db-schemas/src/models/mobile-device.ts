import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** The same values as MOBILE_APPS and MOBILE_PLATFORMS in @markaz/contracts (this package depends on mongoose only). */
export const MOBILE_DEVICE_APPS = ['seller', 'admin'] as const;
export const MOBILE_DEVICE_PLATFORMS = ['android'] as const;

/**
 * Collection: mobiledevices (Sprint 9, EP-31.US01). One row per signed-in phone, and one refresh token family per row.
 *
 * Only the SHA-256 hex of the CURRENT refresh token is stored (select:false): a token that was already used no longer matches it, and presenting it again
 * revokes the family. tokenVersion is the account's tokenVersion at sign-in: once the account moves on (password change or reset, email change, "sign out of all
 * other devices") the row is dead. A revoked row is kept (revokedAt, revokedReason) until retention removes it.
 *
 * Indexes (declared here, planned by scripts/ensure-indexes.mjs):
 *   {family}                    unique: an access or refresh token finds at most one row
 *   {app, user, revokedAt}      a user's device list and "revoke all"
 *   {revokedAt}                 partial (only revoked rows): the retention purge
 *   {pushToken}                 partial (only rows with one): a token that moved to another phone, or that the push service calls dead
 */
export interface IMobileDevice {
  _id: Types.ObjectId;
  app: (typeof MOBILE_DEVICE_APPS)[number];
  user: Types.ObjectId;
  family: string;
  name: string;
  platform: (typeof MOBILE_DEVICE_PLATFORMS)[number];
  appVersion: string;
  /** A random id the app makes once per installation, so signing in again on the same phone replaces its old row. */
  installationId: string | null;
  refreshHash: string;
  refreshExpiresAt: Date;
  tokenVersion: number;
  lastSeenAt: Date;
  /** The push token of this phone (S9-B3). */
  pushToken: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MobileDeviceSchema = new Schema<IMobileDevice>(
  {
    app: { type: String, enum: [...MOBILE_DEVICE_APPS], required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    family: { type: String, required: true, match: /^[A-Za-z0-9_-]{24}$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    platform: { type: String, enum: [...MOBILE_DEVICE_PLATFORMS], required: true },
    appVersion: { type: String, required: true, maxlength: 32 },
    installationId: { type: String, default: null, maxlength: 64 },
    refreshHash: { type: String, required: true, select: false, match: /^[0-9a-f]{64}$/ },
    refreshExpiresAt: { type: Date, required: true },
    tokenVersion: { type: Number, default: 0, min: 0 },
    lastSeenAt: { type: Date, required: true },
    pushToken: { type: String, default: null, maxlength: 255 },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null, maxlength: 40 },
  },
  // bufferCommands off, as the backends connect.
  { timestamps: true, collection: 'mobiledevices', bufferCommands: false },
);

MobileDeviceSchema.index({ family: 1 }, { unique: true, name: 'family_unique' });
MobileDeviceSchema.index({ app: 1, user: 1, revokedAt: 1 }, { name: 'app_user_revokedAt' });
MobileDeviceSchema.index({ revokedAt: 1 }, { name: 'revokedAt_partial', partialFilterExpression: { revokedAt: { $type: 'date' } } });
MobileDeviceSchema.index({ pushToken: 1 }, { name: 'pushToken_partial', partialFilterExpression: { pushToken: { $type: 'string' } } });

export const MobileDevice: Model<IMobileDevice> =
  (mongoose.models.MobileDevice as Model<IMobileDevice> | undefined) ?? mongoose.model<IMobileDevice>('MobileDevice', MobileDeviceSchema);

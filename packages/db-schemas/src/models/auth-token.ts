import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** The same values as AUTH_TOKEN_KINDS in @markaz/auth (this package depends on mongoose only). */
export const AUTH_TOKEN_MODEL_KINDS = ['password_reset', 'email_verify', 'email_change'] as const;

/**
 * Collection: authtokens (Sprint 4 EP-08, D-093). One row per emailed account link. Only the SHA-256 hex of the token
 * is stored; the raw token is in the link alone. A row is used once (usedAt) and MongoDB removes it after expiresAt.
 */
export interface IAuthToken {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  kind: (typeof AUTH_TOKEN_MODEL_KINDS)[number];
  tokenHash: string;
  /** email_change only: the address the link confirms. */
  newEmail?: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuthTokenSchema = new Schema<IAuthToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: [...AUTH_TOKEN_MODEL_KINDS], required: true },
    tokenHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    newEmail: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'authtokens' },
);

AuthTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' });
// A new token of a kind closes the user's older unused ones.
AuthTokenSchema.index({ user: 1, kind: 1, usedAt: 1 });
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken: Model<IAuthToken> =
  (mongoose.models.AuthToken as Model<IAuthToken> | undefined) ?? mongoose.model<IAuthToken>('AuthToken', AuthTokenSchema);

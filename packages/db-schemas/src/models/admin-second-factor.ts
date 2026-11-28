import mongoose, { Schema, type Model, type Types } from 'mongoose';

/**
 * Collection: adminsecondfactors (Sprint 9, EP-31.US01.T07). The TOTP second factor of one admin account, for the phone sign-in. Kept apart from the
 * user document so that no read of an account can carry it.
 *
 * secretSealed is the TOTP secret encrypted with AES-256-GCM; recoveryHashes are SHA-256 of the unused recovery codes (a used one is removed).
 * confirmedAt null means the enrolment was started and no code has proved it yet. lastUsedStep stops an accepted code being used twice.
 *
 * Indexes (declared here, planned by scripts/ensure-indexes.mjs):
 *   {user}   unique: one factor per account
 */
export interface IAdminSecondFactor {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  secretSealed: string;
  confirmedAt: Date | null;
  lastUsedStep: number;
  recoveryHashes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const AdminSecondFactorSchema = new Schema<IAdminSecondFactor>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    secretSealed: { type: String, required: true, maxlength: 400 },
    confirmedAt: { type: Date, default: null },
    lastUsedStep: { type: Number, default: -1 },
    recoveryHashes: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'adminsecondfactors' },
);

AdminSecondFactorSchema.index({ user: 1 }, { unique: true, name: 'user_unique' });

export const AdminSecondFactor: Model<IAdminSecondFactor> =
  (mongoose.models.AdminSecondFactor as Model<IAdminSecondFactor> | undefined) ?? mongoose.model<IAdminSecondFactor>('AdminSecondFactor', AdminSecondFactorSchema);


import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export const USER_ROLES = ['admin', 'seller'] as const;
export type UserRole = (typeof USER_ROLES)[number];
/** Sprint 4 EP-08 (D-093): a suspended or blocked account is refused on every authenticated request. */
export const USER_ACCOUNT_STATUSES = ['active', 'suspended', 'blocked'] as const;
export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

/** Mirrors the Payload Users collection (apps/admin/src/collections/Users.ts). Collection: users. */
export interface IUser extends Document {
name: string;
email: string;
role: UserRole;
store?: Types.ObjectId | null;
passwordHash: string;
loginAttempts: number;
lockUntil: Date | null;
/** EP-07.US03.T03: which alerts the seller also gets by email. In-app alerts are always on. Missing means on. */
notificationPrefs?: { emailNewOrder: boolean; emailLowStock: boolean } | null;
/** Sprint 4 EP-08. Missing on accounts from before: read as active, 0, unverified, none. No migration is needed. */
accountStatus?: UserAccountStatus;
suspensionReason?: string | null;
/** Bumped by a reset, a password change, an email swap and "sign out of all other devices": older tokens stop working. */
tokenVersion?: number;
emailVerifiedAt?: Date | null;
phone?: string | null;
/** The new address of an email change until its link is used; the old email stays the login until then. */
pendingEmail?: string | null;
createdAt: Date;
updatedAt: Date;
}

const UserSchema = new Schema(
{
name: { type: String, required: true },
email: { type: String, required: true, unique: true },
role: { type: String, enum: [...USER_ROLES], required: true, default: 'seller' },
store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
// Never returned by default queries. Routes that verify a password must select it explicitly.
passwordHash: { type: String, required: true, select: false },
loginAttempts: { type: Number, required: true, default: 0 },
lockUntil: { type: Date, default: null },
notificationPrefs: {
type: new Schema(
{
emailNewOrder: { type: Boolean, default: true },
emailLowStock: { type: Boolean, default: true },
},
{ _id: false },
),
default: () => ({ emailNewOrder: true, emailLowStock: true }),
},
accountStatus: { type: String, enum: [...USER_ACCOUNT_STATUSES], default: 'active' },
suspensionReason: { type: String, default: null, maxlength: 300 },
tokenVersion: { type: Number, default: 0, min: 0 },
emailVerifiedAt: { type: Date, default: null },
phone: { type: String, default: null, maxlength: 20 },
pendingEmail: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
},
{ timestamps: true, collection: 'users' },
);

// The sellers list filters by role and sorts by join date.
UserSchema.index({ role: 1, createdAt: -1 });

export const User: Model<IUser> =
(mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>('User', UserSchema, 'users');

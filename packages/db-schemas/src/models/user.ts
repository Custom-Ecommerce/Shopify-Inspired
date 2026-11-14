
import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export const USER_ROLES = ['admin', 'seller'] as const;
export type UserRole = (typeof USER_ROLES)[number];

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
},
{ timestamps: true, collection: 'users' },
);

// The sellers list filters by role and sorts by join date.
UserSchema.index({ role: 1, createdAt: -1 });

export const User: Model<IUser> =
(mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>('User', UserSchema, 'users');

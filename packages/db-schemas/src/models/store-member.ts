import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** The same values as STAFF_ROLES in @markaz/auth (this package depends on mongoose only). */
export const STORE_MEMBER_ROLES = ['manager', 'staff', 'support'] as const;
export const STORE_MEMBER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type StoreMemberRole = (typeof STORE_MEMBER_ROLES)[number];
export type StoreMemberStatus = (typeof STORE_MEMBER_STATUSES)[number];

/**
 * Collection: storemembers (Sprint 8, S8-B2, D-118). One row per person invited to a store's team. The OWNER of a store is never a row: the account that owns
 * the store is the owner. A person is invited by email (stored lowercased); the row is `invited` until they accept, `active` while they work in the store, and `disabled`
 * when the owner switches their access off (a disabled member keeps the row and the seat is released). Removing a member deletes the row.
 *
 * tokenHash is the SHA-256 hex of the emailed invite token (select:false): the raw token exists only in the link. Accepting sets the user, clears the hash and
 * sets acceptedAt. expiresAt is the end of the invite (7 days); an expired invite stays until the owner resends it or removes it. revision is the compare-and-set
 * counter of every change.
 *
 * Indexes (declared here, planned by scripts/ensure-indexes.mjs):
 *   {store, user}   unique, PARTIAL (rows that have a user): a person is a member of a store once
 *   {store, email}  unique, PARTIAL (status invited): ONE open invite per email per store
 *   {tokenHash}     unique, PARTIAL (rows that have a hash): a token finds one invite
 *   {user, status}  the stores a signed-in user belongs to
 */
export interface IStoreMember {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  /** Absent until the invite is accepted. */
  user?: Types.ObjectId | null;
  /** The invited address, lowercased. */
  email: string;
  role: StoreMemberRole;
  status: StoreMemberStatus;
  /** The owner who sent the invite. */
  invitedBy: Types.ObjectId;
  tokenHash?: string | null;
  expiresAt?: Date | null;
  acceptedAt?: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const StoreMemberSchema = new Schema<IStoreMember>(
  {
    store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, enum: [...STORE_MEMBER_ROLES], required: true },
    status: { type: String, enum: [...STORE_MEMBER_STATUSES], required: true, default: 'invited' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, select: false, match: /^[0-9a-f]{64}$/ },
    expiresAt: { type: Date },
    acceptedAt: { type: Date },
    revision: { type: Number, default: 0, min: 0 },
  },
  // bufferCommands off, as the seller backend connects: a lookup before the connection is open fails at once (and the access check then fails closed) instead of waiting.
  { timestamps: true, collection: 'storemembers', bufferCommands: false },
);

// A person is a member of a store once. Only rows that have a user take part (an invite has none yet).
StoreMemberSchema.index({ store: 1, user: 1 }, { unique: true, name: 'store_user_unique', partialFilterExpression: { user: { $type: 'objectId' } } });
// One open invite per email per store. An equality filter: $in in a partial filter is not supported by every MongoDB version.
StoreMemberSchema.index({ store: 1, email: 1 }, { unique: true, name: 'store_email_invited_unique', partialFilterExpression: { status: 'invited' } });
// A token finds exactly one invite; an accepted invite has no hash any more.
StoreMemberSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique', partialFilterExpression: { tokenHash: { $type: 'string' } } });
// The stores of a signed-in user (the workspace list and the access check).
StoreMemberSchema.index({ user: 1, status: 1 }, { name: 'user_status' });

export const StoreMember: Model<IStoreMember> =
  (mongoose.models.StoreMember as Model<IStoreMember> | undefined) ?? mongoose.model<IStoreMember>('StoreMember', StoreMemberSchema);

import mongoose, { Schema, type Document, type Model } from 'mongoose';


/**
 * Collection: audit-log. Entries are immutable: the policy matrix denies update
 * and delete to every actor, and there is no updatedAt field.
 * Field set to be confirmed against the B1 Payload fixture.
 */
export interface IAuditLog extends Document {
  action: string;
  entity: string;
  entityId: string;
  actorId: string;
  details?: unknown;
  createdAt: Date;
}


const AuditLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    actorId: { type: String, required: true, index: true },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit-log' },
);


AuditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
// The unfiltered audit list is newest first; the action filter is newest first within one action.
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });


export const AuditLog: Model<IAuditLog> =
  (mongoose.models.AuditLog as Model<IAuditLog> | undefined) ??
  mongoose.model<IAuditLog>('AuditLog', AuditLogSchema, 'audit-log');

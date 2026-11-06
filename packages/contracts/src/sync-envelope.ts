import { z } from 'zod';

// Mirrors packages/platform-kit/src/sync-schemas.ts. The contract test checks these sets against it.
export const SYNC_SCHEMA_VERSION = 1 as const;
export const SYNC_SOURCES = ['admin', 'seller'] as const;
export const SYNC_ENTITIES = ['store', 'seller', 'platform'] as const;
export const SYNC_GROUPS = ['governance', 'operations', 'profile', 'controls', 'settings'] as const;
export const SYNC_OPS = ['upsert'] as const;

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const syncEnvelopeSchema = z.object({
  schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
  eventId: z.string().regex(ULID_PATTERN, 'eventId must be a ULID'),
  source: z.enum(SYNC_SOURCES),
  entity: z.enum(SYNC_ENTITIES),
  entityId: z.string().min(1).max(128),
  group: z.enum(SYNC_GROUPS),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.string().datetime({ offset: true }),
  op: z.enum(SYNC_OPS),
  data: z.record(z.string(), z.unknown()),
  dataHash: z.string().regex(SHA256_HEX_PATTERN, 'dataHash must be lowercase SHA-256 hex'),
});

export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;

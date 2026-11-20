/**
 * Cross-DB sync contract (blueprint §3.2, §4.6 `sync`, §7.2).
 *
 * Phase 3.1: the envelope schema, the group registry (who is the system of
 * record for what), and the field-level allowlists as data. Pure and
 * Payload-agnostic; the receivers/outbox that consume this land in later
 * steps. Signing lives in `./hmac`.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** Bumped only for breaking envelope changes; receivers reject unknown versions. */
export const SYNC_SCHEMA_VERSION = 1 as const;

export const SYNC_SOURCES = ["admin", "seller"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

/** Receiving side of a delivery. Same domain as {@link SyncSource}. */
export const SYNC_TARGETS = SYNC_SOURCES;
export type SyncTarget = SyncSource;

/**
 * Entities that carry the v2 envelope. `commissionLedger` adopts it after the
 * store flows are stable (§7.2.1) and is added then. Categories are owned by
 * one store on the seller side (D-006), so they are never replicated.
 */
export const SYNC_ENTITIES = ["store", "seller", "platform"] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/** Replicated field groups. Each has exactly one system of record. */
export const SYNC_GROUPS = ["governance", "operations", "profile", "controls", "settings"] as const;
export type SyncGroup = (typeof SYNC_GROUPS)[number];

/** `tombstone` is reserved (§7.2.8) and deliberately absent. */
export const SYNC_OPS = ["upsert"] as const;
export type SyncOp = (typeof SYNC_OPS)[number];

export const SYNC_OUTBOX_STATUSES = ["pending", "sent", "dead"] as const;
export type SyncOutboxStatus = (typeof SYNC_OUTBOX_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* Group registry: direction of replication (§7.2.1 table)                    */
/* -------------------------------------------------------------------------- */

export interface SyncGroupDefinition {
  readonly entity: SyncEntity;
  readonly group: SyncGroup;
  /** System of record: the only side allowed to send this group (receiver rule 3). */
  readonly source: SyncSource;
  /** Read-only replica that applies the snapshots. */
  readonly target: SyncTarget;
}

export const SYNC_GROUP_DEFINITIONS = [
  { entity: "store", group: "governance", source: "admin", target: "seller" },
  { entity: "store", group: "operations", source: "seller", target: "admin" },
  { entity: "seller", group: "profile", source: "seller", target: "admin" },
  { entity: "seller", group: "controls", source: "admin", target: "seller" },
  { entity: "platform", group: "settings", source: "admin", target: "seller" },
] as const satisfies readonly SyncGroupDefinition[];

/** The registered definition for `(entity, group)`, or `null` if that pair does not exist. */
export function getSyncGroupDefinition(
  entity: SyncEntity,
  group: SyncGroup,
): SyncGroupDefinition | null {
  return SYNC_GROUP_DEFINITIONS.find((d) => d.entity === entity && d.group === group) ?? null;
}

/** True when `(entity, group)` is a registered pair. */
export function isValidSyncEntityGroup(entity: SyncEntity, group: SyncGroup): boolean {
  return getSyncGroupDefinition(entity, group) !== null;
}

/**
 * Receiver rule 3: is `source` the system of record for `(entity, group)`?
 * An unregistered pair is never authorized.
 */
export function isSyncSourceOfRecord(
  entity: SyncEntity,
  group: SyncGroup,
  source: SyncSource,
): boolean {
  return getSyncGroupDefinition(entity, group)?.source === source;
}

/* -------------------------------------------------------------------------- */
/* Field-level allowlists (§3.2, §7.2.1)                                      */
/* -------------------------------------------------------------------------- */

/*
 * Entries are dot-paths into the group's `data` object.
 *   "status"             exactly that field
 *   "billing.foo"        exactly that nested field
 *   "storefront.*"       the whole `storefront` subtree (any depth)
 * Anything not matched is a stray: receivers drop and log it (rule 4).
 *
 * The store `id` is NOT in any list: it travels as the envelope `entityId`.
 * Revisions are NOT in `data`: they travel as the envelope `revision` and
 * receivers never write them from `data`.
 */

/**
 * `store.governance` — Admin → Seller. Every Admin-owned replicated store
 * field (§3.2): identity, governance, and billing/subscription FLAGS only.
 */
export const GOVERNANCE_ALLOWLIST = [
  // Identity
  "slug",
  "internalHandle",
  "referralCode",
  "referredBy",
  "isThemeDemo",
  // Governance
  "status",
  "suspensionReason",
  "suspensionNote",
  "suspendedAt",
  "statusChangedAt",
  "commissionMode",
  "commissionRate",
  "owner",
  "domain",
  "customDomainStatus",
  "archivedAt",
  // Billing flags
  "billing.stripeOnboardingStatus",
  "billing.stripeChargesEnabled",
  "billing.stripePayoutsEnabled",
  // Subscription flags
  "subscription.subscriptionStatus",
  "subscription.subscriptionPlan",
] as const;

/** `store.operations` — Seller → Admin. */
export const OPERATIONS_ALLOWLIST = [
  "name",
  "storefront.*",
  "paymentSettings.*",
  "courierSettings.*",
] as const;

/** `seller.profile` — Seller → Admin. Never credentials. */
export const PROFILE_ALLOWLIST = ["email", "name"] as const;

/** `seller.controls` — Admin → Seller. */
export const CONTROLS_ALLOWLIST = ["accountStatus", "storeLimitOverride"] as const;

/** `platform.settings` — Admin → Seller. */
export const SETTINGS_ALLOWLIST = ["defaultCommissionRate", "maxStoresPerSeller", "storeApprovalRequired"] as const;

export const SYNC_GROUP_ALLOWLISTS = {
  governance: GOVERNANCE_ALLOWLIST,
  operations: OPERATIONS_ALLOWLIST,
  profile: PROFILE_ALLOWLIST,
  controls: CONTROLS_ALLOWLIST,
  settings: SETTINGS_ALLOWLIST,
} as const satisfies Record<SyncGroup, readonly string[]>;

export type SyncAllowlistEntry = (typeof SYNC_GROUP_ALLOWLISTS)[SyncGroup][number];

/**
 * Store fields that must NEVER cross the DB boundary in either direction
 * (§3.2 "Billing secrets"). Not an allowlist; a tripwire for tests/guards.
 */
export const SYNC_NEVER_REPLICATED_FIELDS = [
  "billing.stripeConnectedAccountId",
  "subscription.stripeCustomerId",
  "subscription.stripeSubscriptionId",
] as const;

const WILDCARD_SUFFIX = ".*";

function hasWildcardCover(allowlist: readonly string[], path: string): boolean {
  return allowlist.some((entry) => {
    if (!entry.endsWith(WILDCARD_SUFFIX)) return false;
    const base = entry.slice(0, -WILDCARD_SUFFIX.length);
    return path === base || path.startsWith(`${base}.`);
  });
}

/** Does `path` (e.g. `"storefront.theme.color"`) fall inside `allowlist`? */
export function isAllowlistedPath(allowlist: readonly string[], path: string): boolean {
  return allowlist.includes(path) || hasWildcardCover(allowlist, path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  // defineProperty so a key like "__proto__" becomes a plain own property.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export interface AllowlistFilterResult {
  /** Only allowlisted members. Wildcard subtrees are kept by reference, not cloned. */
  readonly data: Record<string, unknown>;
  /** Dot-paths that were dropped (for receiver logging, rule 4). */
  readonly strays: readonly string[];
}

/**
 * Keep only what `allowlist` permits and report the rest (receiver rule 4).
 * Pure: never mutates `input`.
 */
export function filterToAllowlist(
  input: Readonly<Record<string, unknown>>,
  allowlist: readonly string[],
): AllowlistFilterResult {
  const strays: string[] = [];

  const walk = (source: Readonly<Record<string, unknown>>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const value = source[key];
      if (isAllowlistedPath(allowlist, path)) {
        setOwn(out, key, value);
      } else if (isPlainObject(value) && allowlist.some((entry) => entry.startsWith(`${path}.`))) {
        // An allowed descendant exists (e.g. "billing" for "billing.stripeChargesEnabled").
        const nested = walk(value, path);
        if (Object.keys(nested).length > 0) {
          setOwn(out, key, nested);
        }
      } else {
        strays.push(path);
      }
    }
    return out;
  };

  return { data: walk(input, ""), strays };
}

/** Convenience wrapper: filter `data` against the allowlist of `group`. */
export function filterToGroupAllowlist(
  group: SyncGroup,
  data: Readonly<Record<string, unknown>>,
): AllowlistFilterResult {
  return filterToAllowlist(data, SYNC_GROUP_ALLOWLISTS[group]);
}

/* -------------------------------------------------------------------------- */
/* Envelope (§7.2.3)                                                          */
/* -------------------------------------------------------------------------- */

/** ULID: 26 chars, Crockford base32, uppercase, timestamp prefix <= 7ZZZ…. */
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** Lowercase hex SHA-256. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const syncEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(SYNC_SCHEMA_VERSION),
    eventId: z.string().regex(ULID_PATTERN, "eventId must be a ULID"),
    source: z.enum(SYNC_SOURCES),
    entity: z.enum(SYNC_ENTITIES),
    entityId: z.string().min(1).max(128),
    group: z.enum(SYNC_GROUPS),
    /** Monotonic per (entity, entityId, group), assigned by the SoR; always >= 1. */
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** Informational only; never used for ordering. */
    occurredAt: z.string().datetime({ offset: true }),
    op: z.enum(SYNC_OPS),
    /** Allowlisted group snapshot. Field filtering is the receiver's job (rule 4). */
    data: z.record(z.string(), z.unknown()),
    /** SHA-256 hex of the canonical JSON of `data` (see `computeDataHash`). */
    dataHash: z.string().regex(SHA256_HEX_PATTERN, "dataHash must be lowercase SHA-256 hex"),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    // Shape check only. Whether `source` is the SoR is receiver rule 3 (403),
    // which must stay distinguishable from a malformed envelope (400).
    if (!isValidSyncEntityGroup(envelope.entity, envelope.group)) {
      ctx.addIssue({
        code: "custom",
        path: ["group"],
        message: `group "${envelope.group}" does not exist for entity "${envelope.entity}"`,
      });
    }
  });

export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;

/** Parse an unknown value into a {@link SyncEnvelope} without throwing. */
export function parseSyncEnvelope(input: unknown) {
  return syncEnvelopeSchema.safeParse(input);
}

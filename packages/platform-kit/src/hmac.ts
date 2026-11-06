/**
 * Sync v2 request signing (blueprint §7.2.3).
 *
 *   x-sync-key-id    id of the secret used (two ids may be live for rotation)
 *   x-sync-timestamp Unix epoch in MILLISECONDS, decimal string
 *   x-sync-signature lowercase hex of HMAC-SHA256(secret[keyId], timestamp + "." + rawBody)
 *
 * Payload-agnostic and framework-free. Uses `node:crypto`, so import this
 * module from server code only (Payload backends, route handlers on the
 * Node runtime), never from browser bundles.
 *
 * `rawBody` MUST be the exact bytes/string that travel on the wire. Sign the
 * serialized string you send, and verify against the unparsed request body;
 * never re-serialize a parsed object.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SYNC_HEADER_KEY_ID = "x-sync-key-id";
export const SYNC_HEADER_TIMESTAMP = "x-sync-timestamp";
export const SYNC_HEADER_SIGNATURE = "x-sync-signature";

/** Maximum clock skew accepted between sender and receiver (5 minutes). */
export const SYNC_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const SIGNATURE_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const TIMESTAMP_PATTERN = /^[0-9]{1,16}$/;

export type SyncRawBody = string | Uint8Array;

export interface SyncSignatureHeaders {
  [SYNC_HEADER_KEY_ID]: string;
  [SYNC_HEADER_TIMESTAMP]: string;
  [SYNC_HEADER_SIGNATURE]: string;
}

export interface SignSyncBodyInput {
  secret: string;
  /** Epoch milliseconds as a decimal string (the exact value sent in the header). */
  timestamp: string;
  rawBody: SyncRawBody;
}

/**
 * Compute `HMAC-SHA256(secret, timestamp + "." + rawBody)` as lowercase hex.
 * @throws if `secret` is empty or `timestamp` is not a decimal string.
 */
export function signSyncBody({ secret, timestamp, rawBody }: SignSyncBodyInput): string {
  if (secret.length === 0) {
    throw new Error("signSyncBody: secret must not be empty");
  }
  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    throw new Error("signSyncBody: timestamp must be an epoch-milliseconds decimal string");
  }
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

export interface BuildSyncHeadersInput {
  keyId: string;
  secret: string;
  rawBody: SyncRawBody;
  /** Epoch milliseconds. Defaults to `Date.now()`; injectable for tests. */
  now?: number;
}

/** Build the three `x-sync-*` headers for an outgoing request. */
export function buildSyncHeaders({
  keyId,
  secret,
  rawBody,
  now = Date.now(),
}: BuildSyncHeadersInput): SyncSignatureHeaders {
  if (keyId.length === 0) {
    throw new Error("buildSyncHeaders: keyId must not be empty");
  }
  const timestamp = String(Math.trunc(now));
  return {
    [SYNC_HEADER_KEY_ID]: keyId,
    [SYNC_HEADER_TIMESTAMP]: timestamp,
    [SYNC_HEADER_SIGNATURE]: signSyncBody({ secret, timestamp, rawBody }),
  };
}

/**
 * Why a signature was rejected. All of these map to HTTP 401 (receiver
 * rule 1): permanent for the sender, so it should stop and alert.
 */
export const SYNC_SIGNATURE_FAILURES = [
  "MISSING_HEADERS",
  "UNKNOWN_KEY_ID",
  "BAD_TIMESTAMP",
  "TIMESTAMP_SKEW",
  "BAD_SIGNATURE",
] as const;
export type SyncSignatureFailure = (typeof SYNC_SIGNATURE_FAILURES)[number];

export type VerifySyncSignatureResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: SyncSignatureFailure };

export interface VerifySyncSignatureInput {
  /** Active secrets by key id (normally one or two entries during rotation). */
  secrets: Readonly<Record<string, string | undefined>>;
  /** Raw header values; pass `null`/`undefined` when a header is absent. */
  keyId: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: SyncRawBody;
  /** Epoch milliseconds. Defaults to `Date.now()`; injectable for tests. */
  now?: number;
  /** Defaults to {@link SYNC_TIMESTAMP_TOLERANCE_MS}. */
  toleranceMs?: number;
}

/**
 * Verify an incoming signed request. Never throws on bad input; returns a
 * discriminated result. The signature comparison is constant-time.
 */
export function verifySyncSignature(input: VerifySyncSignatureInput): VerifySyncSignatureResult {
  const { secrets, keyId, timestamp, signature, rawBody } = input;
  const now = input.now ?? Date.now();
  const toleranceMs = input.toleranceMs ?? SYNC_TIMESTAMP_TOLERANCE_MS;

  if (!keyId || !timestamp || !signature) {
    return { ok: false, reason: "MISSING_HEADERS" };
  }

  // Own-property lookup only: a key id such as "__proto__" or "constructor"
  // must never resolve to something inherited from Object.prototype.
  const secret = Object.prototype.hasOwnProperty.call(secrets, keyId) ? secrets[keyId] : undefined;
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "UNKNOWN_KEY_ID" };
  }

  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    return { ok: false, reason: "BAD_TIMESTAMP" };
  }
  if (Math.abs(now - Number(timestamp)) > toleranceMs) {
    return { ok: false, reason: "TIMESTAMP_SKEW" };
  }

  if (!SIGNATURE_HEX_PATTERN.test(signature)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }

  const expected = Buffer.from(signSyncBody({ secret, timestamp, rawBody }), "hex");
  const provided = Buffer.from(signature, "hex");
  // Both are 32 bytes here (hex pattern enforced above), as timingSafeEqual requires.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  return { ok: true, keyId };
}

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace,
 * `undefined` object members omitted (as `JSON.stringify` does). Both
 * backends must hash identical bytes for a given snapshot (§7.2.3 `dataHash`).
 * @throws on values JSON cannot represent (non-finite numbers, bigint,
 * functions, symbols) and on circular references.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("canonicalJson: non-finite number is not representable");
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
  }

  const obj = value as object;
  if (ancestors.has(obj)) {
    throw new Error("canonicalJson: circular reference");
  }

  // Honour toJSON (e.g. Date -> ISO string), exactly like JSON.stringify.
  const toJSON = (obj as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    ancestors.add(obj);
    try {
      return canonicalize((toJSON as () => unknown).call(obj), ancestors);
    } finally {
      ancestors.delete(obj);
    }
  }

  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      // Like JSON.stringify, array holes/undefined become null.
      const items = obj.map((item: unknown) =>
        item === undefined || typeof item === "function" || typeof item === "symbol"
          ? "null"
          : canonicalize(item, ancestors),
      );
      return `[${items.join(",")}]`;
    }

    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const member = record[key];
      if (member === undefined || typeof member === "function" || typeof member === "symbol") {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${canonicalize(member, ancestors)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    ancestors.delete(obj);
  }
}

/** SHA-256 (lowercase hex) of the canonical JSON of `data` — the envelope `dataHash`. */
export function computeDataHash(data: unknown): string {
  return createHash("sha256").update(canonicalJson(data), "utf8").digest("hex");
}

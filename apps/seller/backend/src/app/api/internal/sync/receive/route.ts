import { unwrapCjs } from '@/lib/cjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as syncCoreNs from '@markaz/sync-core';
const syncCore: any = unwrapCjs(syncCoreNs);
const { StaleRevisionError, createMongooseSyncPersistence, isStaleRevision, processBatch } = syncCore;
import type { SyncBatch, SyncEnvelope, SyncOutcome } from '@markaz/sync-core';
import {
SYNC_HEADER_KEY_ID,
SYNC_HEADER_SIGNATURE,
SYNC_HEADER_TIMESTAMP,
computeDataHash,
verifySyncSignature,
} from '@markaz/platform-kit/hmac';
import {
filterToGroupAllowlist,
getSyncGroupDefinition,
parseSyncEnvelope,
} from '@markaz/platform-kit/sync-schemas';
import type { SyncGroup } from '@markaz/platform-kit/sync-schemas';
import { connectSellerDb } from '@/lib/mongo';

/**
* Seller sync receiver (admin -> seller).
*
* 401 bad or missing signature 400 malformed batch, envelope or dataHash
* 403 source is not the system of record, or the group is not addressed to the seller
* 413 body too large 503 not configured or database unavailable
* 200 per-envelope outcomes (applied, stale, duplicate, rejected, failed)
*
* Envelopes are applied in the order sent; the sender must order revisions per
* (entity, entityId, group).
*/
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ENVELOPES = 100;
const MIN_SECRET_LENGTH = 32;

const batchSchema = z
.object({ envelopes: z.array(z.unknown()).min(1).max(MAX_ENVELOPES) })
.strict();

function fail(status: number, message: string): NextResponse {
return NextResponse.json({ errors: [{ message }] }, { status });
}

/** Active signing secrets by key id: the current key and, during rotation, the previous one. */
function loadSyncSecrets(): Record<string, string> {
const secrets: Record<string, string> = Object.create(null);
const add = (id: string | undefined, secret: string | undefined): void => {
if (id && secret && secret.length >= MIN_SECRET_LENGTH) secrets[id] = secret;
};
add(process.env.SYNC_KEY_ID_CURRENT, process.env.SYNC_SECRET_CURRENT);
add(process.env.SYNC_KEY_ID_PREVIOUS, process.env.SYNC_SECRET_PREVIOUS);
return secrets;
}

export async function POST(request: Request): Promise<Response> {
// Rule 1: authenticate before doing anything else, over the exact bytes received.
const secrets = loadSyncSecrets();
if (Object.keys(secrets).length === 0) {
return fail(503, 'Sync receiver is not configured');
}

const declaredLength = Number(request.headers.get('content-length') ?? '0');
if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
return fail(413, 'Request body too large');
}
const rawBody = await request.text();
if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
return fail(413, 'Request body too large');
}

const verdict = verifySyncSignature({
secrets,
keyId: request.headers.get(SYNC_HEADER_KEY_ID),
timestamp: request.headers.get(SYNC_HEADER_TIMESTAMP),
signature: request.headers.get(SYNC_HEADER_SIGNATURE),
rawBody,
});
if (!verdict.ok) {
return fail(401, 'Sync signature rejected: ' + verdict.reason);
}

// Shape: the whole batch is rejected if any envelope is malformed.
let parsedBody: unknown;
try {
parsedBody = JSON.parse(rawBody);
} catch {
return fail(400, 'Body is not valid JSON');
}
const batchShape = batchSchema.safeParse(parsedBody);
if (!batchShape.success) {
return fail(400, 'Invalid batch: ' + (batchShape.error.issues[0]?.message ?? 'unknown error'));
}

const envelopes: SyncEnvelope[] = [];
for (let i = 0; i < batchShape.data.envelopes.length; i += 1) {
const parsed = parseSyncEnvelope(batchShape.data.envelopes[i]);
if (!parsed.success) {
return fail(400, 'envelopes[' + i + ']: ' + (parsed.error.issues[0]?.message ?? 'invalid envelope'));
}
const envelope = parsed.data;

let hash: string;
try {
hash = computeDataHash(envelope.data);
} catch {
return fail(400, 'envelopes[' + i + ']: data cannot be hashed');
}
if (hash !== envelope.dataHash) {
return fail(400, 'envelopes[' + i + ']: dataHash does not match data');
}

// Rule 3: the sender must be the system of record, and this seller must be the target.
const definition = getSyncGroupDefinition(envelope.entity, envelope.group);
if (!definition || definition.source !== envelope.source || definition.target !== 'seller') {
return fail(
403,
'envelopes[' + i + ']: ' + envelope.source + ' may not send ' + envelope.entity + '.' + envelope.group + ' to the seller',
);
}

envelopes.push(envelope);
}

try {
await connectSellerDb();
} catch {
return fail(503, 'Seller database unavailable');
}

const persistence = createMongooseSyncPersistence();

async function applyEnvelope(envelope: SyncEnvelope): Promise<SyncOutcome> {
const stored = await persistence.load(envelope.entity, envelope.entityId, envelope.group);

// Same revision again is a replay; lower is stale. Both are reported, never silent.
if (stored !== null && envelope.revision === stored) return 'duplicate';
if (isStaleRevision(envelope.revision, stored)) return 'stale';

// Rule 4: drop and log anything outside the group's allowlist.
const { data, strays } = filterToGroupAllowlist(envelope.group as SyncGroup, envelope.data);
if (strays.length > 0) {
console.warn(
'[sync] dropped stray fields',
JSON.stringify({ eventId: envelope.eventId, group: envelope.group, strays }),
);
}

try {
await persistence.save({ ...envelope, data });
return 'applied';
} catch (err) {
if (err instanceof StaleRevisionError) return 'stale';
throw err;
}
}

const batch: SyncBatch = { envelopes };
const result = await processBatch(batch, applyEnvelope);

return NextResponse.json(result, { status: 200 });
}

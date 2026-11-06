import { unwrapCjs } from '@/lib/cjs';

import mongoose from 'mongoose';
import * as dbSchemasNs from '@markaz/db-schemas';
const dbSchemas: any = unwrapCjs(dbSchemasNs);
const Store = dbSchemas.Store;
import {
  SYNC_HEADER_KEY_ID,
  SYNC_HEADER_SIGNATURE,
  SYNC_HEADER_TIMESTAMP,
  verifySyncSignature,
} from '@markaz/platform-kit/hmac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ITEMS = 200;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

interface DigestItem {
  entity: string;
  entityId: string;
  group: string;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function loadSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  const pairs: Array<[string | undefined, string | undefined]> = [
    [process.env.SYNC_KEY_ID_CURRENT, process.env.SYNC_SECRET_CURRENT],
    [process.env.SYNC_KEY_ID_PREVIOUS, process.env.SYNC_SECRET_PREVIOUS],
  ];
  for (const [keyId, secret] of pairs) {
    if (keyId && secret) secrets[keyId] = secret;
  }
  return secrets;
}

function parseItems(value: unknown): DigestItem[] | null {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { items?: unknown }).items)) {
    return null;
  }
  const items = (value as { items: unknown[] }).items;
  if (items.length > MAX_ITEMS) return null;
  const out: DigestItem[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.entity !== 'string' || typeof record.entityId !== 'string' || typeof record.group !== 'string') {
      return null;
    }
    out.push({ entity: record.entity, entityId: record.entityId, group: record.group });
  }
  return out;
}

async function ensureSellerDb(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.SELLER_MONGODB_URI;
  if (!uri) throw new Error('SELLER_MONGODB_URI is not set');
  await mongoose.connect(uri);
}

export async function POST(request: Request): Promise<Response> {
  const secrets = loadSecrets();
  if (Object.keys(secrets).length === 0) return json({ error: 'Sync is not configured.' }, 503);

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json({ error: 'Request body too large.' }, 413);

  const verified = verifySyncSignature({
    secrets,
    keyId: request.headers.get(SYNC_HEADER_KEY_ID),
    timestamp: request.headers.get(SYNC_HEADER_TIMESTAMP),
    signature: request.headers.get(SYNC_HEADER_SIGNATURE),
    rawBody,
  });
  if (!verified.ok) return json({ error: 'Unauthorized.' }, 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const items = parseItems(parsed);
  if (!items) return json({ error: 'invalid digest request' }, 422);

  await ensureSellerDb();

  const revisions: Record<string, number | null> = {};
  for (const item of items) {
    const id = item.entity + '|' + item.entityId + '|' + item.group;
    let value: number | null = null;
    if (item.entity === 'store' && OBJECT_ID_PATTERN.test(item.entityId)) {
      const doc = (await Store.findById(item.entityId)
        .select({ govRevision: 1, opsRevision: 1 })
        .lean()) as { govRevision?: number; opsRevision?: number } | null;
      if (doc && item.group === 'governance' && typeof doc.govRevision === 'number') value = doc.govRevision;
      if (doc && item.group === 'operations' && typeof doc.opsRevision === 'number') value = doc.opsRevision;
    }
    revisions[id] = value;
  }
  return json({ revisions }, 200);
}

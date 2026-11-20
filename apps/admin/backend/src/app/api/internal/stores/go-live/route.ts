import { Types } from 'mongoose';
import { assertCan, PolicyDeniedError, Store } from '@/lib/workspace';
import { connectDb } from '@/lib/db';
import { isRecord, jsonResponse, requireInternalSignature } from '@/lib/internal-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GoLiveReport {
  storeId: string;
  status: 'active' | 'pending';
  goLiveRequestedAt: Date;
}

function readReport(value: unknown): GoLiveReport | null {
  if (!isRecord(value)) return null;
  const { storeId, status, goLiveRequestedAt } = value;
  if (typeof storeId !== 'string' || !Types.ObjectId.isValid(storeId)) return null;
  if (status !== 'active' && status !== 'pending') return null;
  if (typeof goLiveRequestedAt !== 'string') return null;
  const at = new Date(goLiveRequestedAt);
  if (Number.isNaN(at.getTime())) return null;
  return { storeId, status, goLiveRequestedAt: at };
}

/**
 * POST /api/internal/stores/go-live (Sprint 4 D-098 A2). The seller backend tells this console that its store went live
 * (status active) or asked for approval (status pending, goLiveRequestedAt set), because the console reads its own copy of the
 * store. Signed with the sync key, like the other internal routes. Idempotent: a store moves from pending to active once, and
 * the request time is set once; a repeat changes nothing. A suspended or archived store is never touched. No sync event is
 * queued: the seller already holds this state.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalSignature(request);
  if (!auth.ok) return auth.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(auth.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const report = readReport(parsed);
  if (!report) return jsonResponse({ error: 'invalid body' }, 422);

  try {
    assertCan('system', 'update', 'stores', ['status', 'statusChangedAt', 'goLiveRequestedAt']);
  } catch (err) {
    if (err instanceof PolicyDeniedError) return jsonResponse({ error: err.message }, 403);
    throw err;
  }

  await connectDb();
  const at = report.goLiveRequestedAt;
  const result =
    report.status === 'active'
      ? await Store.updateOne(
          { _id: report.storeId, status: 'pending' } as never,
          { $set: { status: 'active', statusChangedAt: at, goLiveRequestedAt: at } } as never,
        )
      : await Store.updateOne(
          { _id: report.storeId, status: 'pending', goLiveRequestedAt: null } as never,
          { $set: { goLiveRequestedAt: at } } as never,
        );
  if (result.matchedCount === 1) return jsonResponse({ changed: true }, 200);

  const exists = await Store.exists({ _id: report.storeId } as never);
  if (!exists) return jsonResponse({ error: 'store not found' }, 404);
  return jsonResponse({ changed: false }, 200);
}

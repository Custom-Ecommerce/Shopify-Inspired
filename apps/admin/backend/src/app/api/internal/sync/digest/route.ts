import { connectDb } from '@/lib/db';
import { digest } from '@/lib/sync-receiver';
import { jsonResponse, requireSyncSignature } from '../_guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/sync/digest { store, headRevision, group? }: ok, behind or ahead of what was acknowledged, with the gap. Signed. */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireSyncSignature(request);
  if (!guard.ok) return guard.response;

  let payload: unknown;
  try {
    payload = JSON.parse(guard.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  await connectDb();
  const answer = await digest(payload);
  if (answer === null) return jsonResponse({ error: 'invalid digest' }, 422);
  return jsonResponse(answer, 200);
}

import type { NextRequest } from 'next/server';
import { retentionRunRequestSchema } from '@/lib/contracts';
import { moderationAction } from '@/lib/moderation';
import { runRetention } from '@/lib/retention-purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/internal/retention/admin { apply? } (Sprint 6 S6-B7). Signed by the admin backend (owner level there). A dry run unless apply is true. The audit line names the admin. */
export function POST(request: NextRequest): Promise<Response> {
  return moderationAction(request, retentionRunRequestSchema, (input, adminId) => runRetention({ apply: input.apply === true, now: new Date(), actorId: 'admin:' + adminId }));
}

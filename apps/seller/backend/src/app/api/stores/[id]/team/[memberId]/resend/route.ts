import type { NextRequest } from 'next/server';
import { teamMemberActionRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { resendInvite } from '@/lib/team';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/team/:memberId/resend  { revision } (S8-B2, D-118). OWNER ONLY. A new link for an open invitation; the old link stops working at once.
 * ONE compare-and-set on the revision that was read (409 MEMBER_CHANGED). 409 MEMBER_STATE when it is not an open invitation. A member of another store is a 404.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }): Promise<Response> {
  try {
    const { id, memberId } = await context.params;
    const { storeId, actor, body } = await prepareTeamRoute<{ revision: number }>(request, id, teamMemberActionRequestSchema, 'team.manage');
    return json({ member: await resendInvite(storeId, actor, memberId, body.revision) });
  } catch (err) {
    return handleRouteError(err);
  }
}

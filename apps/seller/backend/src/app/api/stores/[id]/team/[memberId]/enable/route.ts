import type { NextRequest } from 'next/server';
import { teamMemberActionRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { enableMember } from '@/lib/team';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/team/:memberId/enable  { revision } (S8-B2, D-118). OWNER ONLY. Gives a disabled member their access back. The seat is counted again, so a full
 * team is 403 PLAN_LIMIT_REACHED. ONE compare-and-set on the revision that was read (409 MEMBER_CHANGED). 409 MEMBER_STATE when the member is not disabled.
 * A member of another store is a 404.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }): Promise<Response> {
  try {
    const { id, memberId } = await context.params;
    const { storeId, actor, body } = await prepareTeamRoute<{ revision: number }>(request, id, teamMemberActionRequestSchema, 'team.manage');
    return json({ member: await enableMember(storeId, actor, memberId, body.revision) });
  } catch (err) {
    return handleRouteError(err);
  }
}

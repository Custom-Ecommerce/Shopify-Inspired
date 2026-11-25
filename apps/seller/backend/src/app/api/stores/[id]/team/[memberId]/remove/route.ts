import type { NextRequest } from 'next/server';
import { teamMemberActionRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { removeMember } from '@/lib/team';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/team/:memberId/remove  { revision } (S8-B2, D-118). OWNER ONLY. Removes a member or an open invitation: the row is deleted in ONE compare-and-set on
 * the revision that was read (409 MEMBER_CHANGED), so the next request of that person is refused. A member who had access is told by email. A member of another store is a 404.
 *
 *   200 { removed: true }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }): Promise<Response> {
  try {
    const { id, memberId } = await context.params;
    const { storeId, actor, body } = await prepareTeamRoute<{ revision: number }>(request, id, teamMemberActionRequestSchema, 'team.manage');
    return json(await removeMember(storeId, actor, memberId, body.revision));
  } catch (err) {
    return handleRouteError(err);
  }
}

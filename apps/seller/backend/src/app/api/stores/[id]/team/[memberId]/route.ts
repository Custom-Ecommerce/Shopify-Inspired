import type { NextRequest } from 'next/server';
import { teamRoleChangeRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { changeMemberRole } from '@/lib/team';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/stores/:id/team/:memberId  { role, revision } (S8-B2, D-118). OWNER ONLY. Changes a member's role in ONE compare-and-set on the revision that was read.
 * A member of another store is a 404.
 *
 *   200 { member }   400   403   404   409 MEMBER_CHANGED
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }): Promise<Response> {
  try {
    const { id, memberId } = await context.params;
    const { storeId, actor, body } = await prepareTeamRoute<{ role: string; revision: number }>(request, id, teamRoleChangeRequestSchema);
    return json({ member: await changeMemberRole(storeId, actor, memberId, body.role, body.revision) });
  } catch (err) {
    return handleRouteError(err);
  }
}

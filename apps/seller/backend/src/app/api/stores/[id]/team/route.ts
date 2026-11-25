import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { ownerOfStore } from '@/lib/plan';
import { listTeam } from '@/lib/team';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id/team (S8-B2, D-118). The members of the store with their role and status, and the seats in use against the plan. OWNER ONLY (capability team.manage):
 * a manager, staff, support, an invited or disabled member and a stranger are refused with 403. The token hash is never in the answer.
 *
 *   200 { members, seats: { used, limit } }   401   403   404 unknown store id
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { storeId } = await prepareTeamRoute<undefined>(request, id, null, 'team.manage');
    const ownerId = (await ownerOfStore(storeId)) ?? '';
    return json(await listTeam(storeId, ownerId));
  } catch (err) {
    return handleRouteError(err);
  }
}

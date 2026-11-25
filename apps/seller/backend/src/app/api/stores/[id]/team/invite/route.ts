import type { NextRequest } from 'next/server';
import { teamInviteRequestSchema } from '@/lib/contracts';
import { handleRouteError } from '@/lib/http';
import { inviteMember } from '@/lib/team';
import { json, prepareTeamRoute } from '@/lib/team-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/team/invite  { email, role } (S8-B2, D-118). OWNER ONLY. Creates an invited member and queues the invite email with a 7 day link; only the token's
 * hash is stored. Order: authenticate -> seller -> parse (400 + field) -> DB -> id -> owner (403) -> the owner's own email (409 OWNER_EMAIL) -> one invite per email
 * per store (409 INVITE_EXISTS / ALREADY_MEMBER) -> the plan's staff seats (403 PLAN_LIMIT_REACHED, invited and active members count) -> the write -> audit.
 *
 *   201 { member }   400 ACCOUNT_BODY_INVALID { field }   403   409
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const { storeId, actor, body } = await prepareTeamRoute<{ email: string; role: string }>(request, id, teamInviteRequestSchema, 'team.manage');
    return json({ member: await inviteMember(storeId, actor, body) }, 201);
  } catch (err) {
    return handleRouteError(err);
  }
}

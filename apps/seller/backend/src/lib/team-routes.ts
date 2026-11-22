import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { readAccountBody } from '@/lib/account-support';
import { resolveStoreAccess } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { requireSellerActor } from '@/lib/owned-store';
import type { TeamActor } from '@/lib/team';

/**
 * Sprint 8 (S8-B2, D-118): what every team route does first, in the standard order: authenticate -> seller session (an admin is refused) -> parse the body (400 with the
 * field) -> DB -> id (a malformed store id is a 404, nothing is read) -> resolveStoreAccess with the capability team.manage (the OWNER only: a manager, staff, support,
 * an invited or disabled member and a stranger are all refused, 403) -> the caller's one compare-and-set write -> audit.
 */

export interface TeamRouteContext {
  storeId: string;
  actor: TeamActor;
}

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

type BodySchema<T> = Parameters<typeof readAccountBody<T>>[1];

export async function prepareTeamRoute<T>(
  request: NextRequest,
  storeParam: string,
  schema: BodySchema<T> | null,
): Promise<TeamRouteContext & { body: T }> {
  const ctx = await authenticate(request);
  requireSellerActor(ctx);
  const body = schema === null ? (undefined as T) : await readAccountBody<T>(request, schema);
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
  if (!mongoose.isValidObjectId(storeParam)) throw new HttpError(404, 'Store not found');
  const access = await resolveStoreAccess(request, ctx, { store: { equals: storeParam } }, { capability: 'team.manage' });
  return { storeId: access.storeId, actor: { userId: ctx.userId, userObjectId: ctx.userObjectId, role: access.role ?? 'owner' }, body };
}

export const json = (body: unknown, status = 200): NextResponse => NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

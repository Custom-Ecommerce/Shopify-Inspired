import mongoose from 'mongoose';
import { AdminHttpError } from '@/lib/admin-auth';
import { readAdminBody } from '@/lib/admin-account';
import { NO_STORE } from '@/lib/admin-session';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { changeAdminLevel, inviteAdminUser, listAdminUsers, setAdminStatus } from '@/lib/admin-users';

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
export const { inviteAdminRequestSchema, acceptInviteRequestSchema, changeLevelRequestSchema, setAdminStatusRequestSchema } = contracts;

/** The handlers behind the users routes. The route files authorize the admin with the users.manage capability (owner level) and pass the operator in. */
export const listUsersFor = async (): Promise<Response> => Response.json(await listAdminUsers(), { headers: NO_STORE });

export async function inviteFor(request: Request, actorId: string): Promise<Response> {
  const body = await readAdminBody(request, inviteAdminRequestSchema);
  return Response.json(await inviteAdminUser(actorId, body), { status: 201, headers: NO_STORE });
}

function idOf(id: string): string {
  if (!mongoose.isValidObjectId(id)) throw new AdminHttpError(404, 'Admin user not found');
  return id;
}

export async function levelFor(request: Request, context: { params: Promise<{ id: string }> }, actorId: string): Promise<Response> {
  const id = idOf((await context.params).id);
  const body = await readAdminBody(request, changeLevelRequestSchema);
  return Response.json(await changeAdminLevel(actorId, id, body), { headers: NO_STORE });
}

export async function statusFor(request: Request, context: { params: Promise<{ id: string }> }, actorId: string, status: 'suspended' | 'active'): Promise<Response> {
  const id = idOf((await context.params).id);
  const body = await readAdminBody(request, setAdminStatusRequestSchema);
  return Response.json(await setAdminStatus(actorId, id, status, body), { headers: NO_STORE });
}

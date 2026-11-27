import * as contractsNs from '@markaz/contracts';
import * as notificationsNs from '@markaz/notifications';
import { readAdminBody } from '@/lib/admin-account';
import { AdminHttpError, errorResponse, requireDatabase } from '@/lib/admin-auth';
import { ANY_ADMIN, authorizeAdmin } from '@/lib/admin-session';
import { unwrapCjs } from '@/lib/cjs';
import { User } from '@/lib/workspace';

const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The kinds this level can receive (the push role table), and the caller's switches. */
const answer = (level: string, prefs: unknown): Response =>
  Response.json(
    { ...notifications.readPushPrefs(prefs), kinds: notifications.ADMIN_PUSH_KINDS.filter((kind) => notifications.PUSH_ROLE_TABLE[kind].includes(level)) },
    { headers: { 'Cache-Control': 'no-store' } },
  );

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId, adminLevel } = await authorizeAdmin(request, ANY_ADMIN);
    await requireDatabase();
    const user = (await User.findById(userId).select('pushPrefs').lean()) as unknown as { pushPrefs?: unknown } | null;
    if (!user) throw new AdminHttpError(401, 'Invalid or expired session');
    return answer(adminLevel, user.pushPrefs);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { userId, adminLevel } = await authorizeAdmin(request, ANY_ADMIN);
    const body = await readAdminBody(request, contracts.mobilePushSettingsUpdateSchema);
    await requireDatabase();
    const set: Record<string, unknown> = {};
    if (body.muted !== undefined) set['pushPrefs.muted'] = body.muted;
    if (body.mutedKinds !== undefined) set['pushPrefs.mutedKinds'] = [...new Set(body.mutedKinds)];
    if (body.quietHours !== undefined) set['pushPrefs.quietHours'] = body.quietHours;
    const updated = (await User.findOneAndUpdate({ _id: userId, role: 'admin' } as never, { $set: set } as never, { new: true })
      .select('pushPrefs')
      .lean()) as unknown as { pushPrefs?: unknown } | null;
    if (!updated) throw new AdminHttpError(401, 'Invalid or expired session');
    return answer(adminLevel, updated.pushPrefs);
  } catch (err) {
    return errorResponse(err);
  }
}

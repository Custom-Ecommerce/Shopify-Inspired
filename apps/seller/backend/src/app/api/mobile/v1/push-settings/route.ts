import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import { auditAccount, NO_STORE, readAccountBody } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { unwrapCjs } from '@/lib/cjs';
import { MOBILE_SELLER_PUSH_KINDS, mobilePushSettingsUpdateSchema } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { assertCan, User } from '@/lib/services';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answer = (prefs: unknown): Response =>
  NextResponse.json({ ...notifications.readPushPrefs(prefs), kinds: [...MOBILE_SELLER_PUSH_KINDS] }, { headers: NO_STORE });

/** GET /api/mobile/v1/push-settings (EP-31.US02.T02): the caller's own push switches. 200 { muted, mutedKinds, kinds }. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.role !== 'seller') throw new HttpError(403, 'Only a seller account has these settings');
    await requireDatabase();
    const user = (await User.findById(ctx.userObjectId).select('pushPrefs').lean()) as { pushPrefs?: unknown } | null;
    if (!user) throw new HttpError(401, 'Invalid or expired session');
    return answer(user.pushPrefs);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** PATCH /api/mobile/v1/push-settings { muted?, mutedKinds?, quietHours? }: mutes everything, some kinds, or some hours of the day (Pakistan time). 200 the settings   400 { field }   401   403 */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.role !== 'seller') throw new HttpError(403, 'Only a seller account has these settings');
    const body = await readAccountBody(request, mobilePushSettingsUpdateSchema);
    assertCan(ctx.actor, 'update', 'sellerAccount', ['pushPrefs']);
    await requireDatabase();
    const set: Record<string, unknown> = {};
    if (body.muted !== undefined) set['pushPrefs.muted'] = body.muted;
    if (body.mutedKinds !== undefined) set['pushPrefs.mutedKinds'] = [...new Set(body.mutedKinds)];
    if (body.quietHours !== undefined) set['pushPrefs.quietHours'] = body.quietHours;
    const updated = (await User.findOneAndUpdate({ _id: ctx.userObjectId, role: 'seller' }, { $set: set }, { new: true, runValidators: true })
      .select('pushPrefs')
      .lean()) as { pushPrefs?: unknown } | null;
    if (!updated) throw new HttpError(401, 'Invalid or expired session');
    await auditAccount(ctx, 'user.push_settings', { fields: Object.keys(set) });
    return answer(updated.pushPrefs);
  } catch (err) {
    return handleRouteError(err);
  }
}

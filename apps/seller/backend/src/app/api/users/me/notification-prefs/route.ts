import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { notificationPrefsUpdateSchema, readNotificationPrefs } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, User, writeAuditLog } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/**
 * GET /api/users/me/notification-prefs (EP-07.US03.T03): the signed-in seller's email switches { emailNewOrder,
 * emailLowStock }. In-app alerts cannot be switched off. A seller who never saved them reads both as on.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'notificationPrefs');
    await requireDatabase();
    const user = (await User.findById(ctx.userObjectId).select('notificationPrefs').lean()) as { notificationPrefs?: unknown } | null;
    if (!user) throw new HttpError(401, 'Invalid or expired session');
    return NextResponse.json({ prefs: readNotificationPrefs(user.notificationPrefs) }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}

function invalid(field: string, message: string): NextResponse {
  return NextResponse.json({ error: message, code: 'PREFS_BODY_INVALID', field }, { status: 400, headers: NO_STORE });
}

/**
 * PATCH /api/users/me/notification-prefs   body: { emailNewOrder?: boolean, emailLowStock?: boolean }
 *
 *   200 { prefs }   400 PREFS_BODY_INVALID { field }   401 no session   403 not a seller   503 database unavailable
 *
 * One write on the seller's own record (dotted paths, so two saves of different switches do not undo each other), then the
 * result is read back from that write. The audit entry is best effort.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'update', 'notificationPrefs', ['emailNewOrder']);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return invalid('body', 'Body must be JSON');
    }
    const parsed = notificationPrefsUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const unknownKey = issue && issue.code === 'unrecognized_keys' ? (issue as { keys?: unknown[] }).keys?.[0] : undefined;
      const field = unknownKey !== undefined ? String(unknownKey) : issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'body';
      return invalid(field, issue?.message ?? 'Invalid request');
    }
    const changes = parsed.data;
    assertCan(ctx.actor, 'update', 'notificationPrefs', Object.keys(changes));

    await requireDatabase();
    const set: Record<string, boolean> = {};
    if (changes.emailNewOrder !== undefined) set['notificationPrefs.emailNewOrder'] = changes.emailNewOrder;
    if (changes.emailLowStock !== undefined) set['notificationPrefs.emailLowStock'] = changes.emailLowStock;

    const updated = (await User.findOneAndUpdate({ _id: ctx.userObjectId, role: 'seller' }, { $set: set }, { new: true, runValidators: true })
      .select('notificationPrefs')
      .lean()) as { notificationPrefs?: unknown } | null;
    if (!updated) throw new HttpError(401, 'Invalid or expired session');

    const prefs = readNotificationPrefs(updated.notificationPrefs);
    try {
      await writeAuditLog('user.notification_prefs', 'user', ctx.userId, 'seller:' + ctx.userId, { changes, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the notification prefs audit entry', err instanceof Error ? err.message : 'unknown error');
    }
    return NextResponse.json({ prefs }, { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}

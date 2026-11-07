import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { isObjectId } from '@/lib/admin-stores';
import { deleteProduct, permanentlyDeleteProduct, restoreProduct, takedownProduct } from '@/lib/seller-moderation-client';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Run = (adminId: string, productId: string, reason: string) => Promise<unknown>;

/** Each action and the policy operation it needs. Anything else is a 404. */
const ACTIONS: Record<string, { operation: 'update' | 'delete'; run: Run }> = {
  takedown: { operation: 'update', run: takedownProduct },
  restore: { operation: 'update', run: (adminId, productId) => restoreProduct(adminId, productId) },
  delete: { operation: 'delete', run: deleteProduct },
  'permanent-delete': { operation: 'delete', run: permanentlyDeleteProduct },
};

/**
 * POST /api/admin/products/:action { productId, reason? }. The operator is the session's, never the body's. The reason's
 * rules are checked by the console and again by the seller backend, which owns the contract.
 */
export async function POST(request: Request, context: { params: Promise<{ action: string }> }): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    const { action } = await context.params;
    const entry = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined;
    if (entry === undefined) throw new AdminHttpError(404, 'Not found');
    requirePolicy(() => assertCan('admin', entry.operation, 'productModeration'));

    const body = (await request.json().catch(() => null)) as { productId?: unknown; reason?: unknown } | null;
    const productId = body?.productId;
    if (typeof productId !== 'string' || !isObjectId(productId)) throw new AdminHttpError(422, 'productId must be a 24-character ObjectId');
    const reason = typeof body?.reason === 'string' ? body.reason : '';

    return Response.json(await entry.run(userId, productId, reason), { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

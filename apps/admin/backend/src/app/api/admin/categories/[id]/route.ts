import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import {
  CATEGORY_FIELDS,
  SLUG_TAKEN_MESSAGE,
  categorySnapshot,
  isDuplicateKeyError,
  parseCategoryUpdate,
  toCategoryRow,
  type CategoryFields,
} from '@/lib/admin-categories';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { isObjectId, type Doc } from '@/lib/admin-stores';
import { assertCan, Category, writeAuditLog } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface CategoryRouteContext {
  params: Promise<{ id: string }>;
}

const NOT_FOUND = 'Category not found';
const NOT_RECORDED = 'The change could not be recorded and was not applied';
const NOT_UNDONE = 'The change could not be recorded, and it could not be undone. Check the category before doing anything else.';
const CHANGED = 'The category was changed by someone else. Reload and try again.';

/**
 * The filter that matches only while the category still holds the values a write was based on. The write is applied
 * compare-and-set: two admins editing at once cannot silently overwrite each other, and a rollback cannot undo a
 * change made after this one.
 */
function stateFilter(id: string, state: CategoryFields): Doc {
  return { _id: id, name: state.name, slug: state.slug, order: state.order, description: state.description };
}

/**
 * PATCH /api/admin/categories/:id. Changes the fields sent. A slug clash is a 409, and so is a category changed by
 * someone else since it was read. The change is audited with the values before and after; if the audit entry cannot
 * be written, the old values are put back and the call fails. If that undo itself fails, the response says so.
 */
export async function PATCH(request: Request, context: CategoryRouteContext): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'update', 'categories', CATEGORY_FIELDS));
    const { id } = await context.params;
    if (!isObjectId(id)) throw new AdminHttpError(404, NOT_FOUND);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseCategoryUpdate(raw);
    if (!input.ok) return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: NO_STORE });

    const found = (await Category.findById(id).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, NOT_FOUND);
    const before = categorySnapshot(found);

    let updated: Doc | null;
    try {
      updated = (await Category.findOneAndUpdate(stateFilter(id, before) as never, { $set: input.data } as never, { new: true }).lean()) as unknown as Doc | null;
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new AdminHttpError(409, SLUG_TAKEN_MESSAGE);
      throw err;
    }
    if (!updated) throw new AdminHttpError(409, CHANGED);
    const after = categorySnapshot(updated);

    try {
      await writeAuditLog('category.update', 'category', id, userId, { before, after });
    } catch (err) {
      const reverted = await Category.updateOne(stateFilter(id, after) as never, { $set: before } as never).then(
        (r) => r.matchedCount === 1,
        () => false,
      );
      console.error('category update rolled back:', err instanceof Error ? err.message : 'unknown error');
      throw new AdminHttpError(500, reverted ? NOT_RECORDED : NOT_UNDONE);
    }

    return Response.json({ category: toCategoryRow(updated) }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/admin/categories/:id. Removes the category, but only while it still holds the values it was read with,
 * and audits it with those values. If the audit entry cannot be written, the whole stored document is restored and
 * the call fails; if the restore itself fails, the response says so.
 */
export async function DELETE(request: Request, context: CategoryRouteContext): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'delete', 'categories'));
    const { id } = await context.params;
    if (!isObjectId(id)) throw new AdminHttpError(404, NOT_FOUND);

    const found = (await Category.findById(id).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, NOT_FOUND);
    const before = categorySnapshot(found);

    const removed = await Category.deleteOne(stateFilter(id, before) as never);
    if (removed.deletedCount === 0) throw new AdminHttpError(409, CHANGED);

    try {
      await writeAuditLog('category.delete', 'category', id, userId, { before });
    } catch (err) {
      const restored = await Category.create({ ...found, _id: id } as never).then(
        () => true,
        () => false,
      );
      console.error('category delete rolled back:', err instanceof Error ? err.message : 'unknown error');
      throw new AdminHttpError(500, restored ? NOT_RECORDED : NOT_UNDONE);
    }

    return Response.json({ deleted: true, id }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

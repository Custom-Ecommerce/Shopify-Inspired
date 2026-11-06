import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import {
  CATEGORY_FIELDS,
  SLUG_TAKEN_MESSAGE,
  buildCategoryFilter,
  categorySnapshot,
  isDuplicateKeyError,
  parseCategoryCreate,
  parseCategoryQuery,
  toCategoryRow,
} from '@/lib/admin-categories';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { listEnvelope, type Doc } from '@/lib/admin-stores';
import { assertCan, Category, writeAuditLog } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/categories. The platform categories for the operator console, by order then name, in the list
 * envelope, with a search over the name and the slug.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'categories'));

    const parsed = parseCategoryQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: 'Invalid request', issues: parsed.issues }, { status: 422, headers: NO_STORE });
    const { query } = parsed;
    const filter = buildCategoryFilter(query) as never;

    const [rows, totalDocs] = await Promise.all([
      Category.find(filter)
        .sort({ order: 1, name: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Category.countDocuments(filter),
    ]);
    const envelope = listEnvelope(
      (rows as unknown as Doc[]).map((doc) => toCategoryRow(doc)),
      { page: query.page, limit: query.limit, totalDocs },
    );
    return Response.json(envelope, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/admin/categories. Creates a category. The slug is unique: a clash is a 409. The write is audited; if the
 * audit entry cannot be written, the category is removed again and the call fails, so no change goes unrecorded.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'create', 'categories', CATEGORY_FIELDS));

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseCategoryCreate(raw);
    if (!input.ok) return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: NO_STORE });

    let created: { _id: unknown; createdAt?: unknown; updatedAt?: unknown };
    try {
      created = (await Category.create(input.data as never)) as unknown as { _id: unknown; createdAt?: unknown; updatedAt?: unknown };
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new AdminHttpError(409, SLUG_TAKEN_MESSAGE);
      throw err;
    }
    const id = String(created._id);

    try {
      await writeAuditLog('category.create', 'category', id, userId, { after: categorySnapshot(input.data as unknown as Doc) });
    } catch (err) {
      const undone = await Category.deleteOne({ _id: id } as never).then((r) => r.deletedCount === 1, () => false);
      if (!undone) throw new AdminHttpError(500, 'The change could not be recorded, and it could not be undone. Check the category before doing anything else.');
      console.error('category create rolled back:', err instanceof Error ? err.message : 'unknown error');
      throw new AdminHttpError(500, 'The change could not be recorded and was not applied');
    }

    const category = toCategoryRow({ _id: created._id, ...input.data, createdAt: created.createdAt, updatedAt: created.updatedAt });
    return Response.json({ category }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

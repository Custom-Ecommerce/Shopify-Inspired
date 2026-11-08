import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { Types } from 'mongoose';
import type { ModerationProduct, ModerationProductList, ModerationProductListQuery, ModerationStatus } from '@markaz/contracts';
import { moderationProductListQuerySchema } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { readSignedRequest } from '@/lib/internal-signature';
import { connectSellerDb } from '@/lib/mongo';
import { ProductRequestError, handleProductError, productNotFound } from '@/lib/products';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { Product, Store, assertCan, writeAuditLog } from '@/lib/services';
import { escapeRegex } from '@/lib/storefront/product-query';
import { purgeProduct } from '@/lib/trash';

const NO_STORE = { 'Cache-Control': 'no-store' };
const FIELDS = 'store title slug isPublished isDemo moderation deletedAt deletedBy createdAt updatedAt';

interface ModerationRow {
  _id: Types.ObjectId;
  store: Types.ObjectId;
  title: string;
  slug: string;
  isPublished?: boolean | null;
  isDemo?: boolean | null;
  moderation?: { reason: string; takenDownAt: Date | string } | null;
  deletedAt?: Date | string | null;
  deletedBy?: { role?: string | null; wasPublished?: boolean | null; reason?: string | null } | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/** The one reading of a product's state. Trash wins: a deleted product is not on offer, whatever else is true of it. */
export function moderationStatusOf(row: Pick<ModerationRow, 'isPublished' | 'isDemo' | 'moderation' | 'deletedAt'>): ModerationStatus {
  if (row.deletedAt) return 'trash';
  if (row.moderation) return 'takedown';
  return row.isPublished === true && row.isDemo !== true ? 'live' : 'draft';
}

function statusFilter(status: ModerationStatus | undefined): Record<string, unknown> {
  switch (status) {
    case 'trash':
      return { deletedAt: { $ne: null } };
    case 'takedown':
      return { deletedAt: null, moderation: { $ne: null } };
    case 'live':
      return { deletedAt: null, moderation: null, isPublished: true, isDemo: { $ne: true } };
    case 'draft':
      return { deletedAt: null, moderation: null, $or: [{ isPublished: { $ne: true } }, { isDemo: true }] };
    default:
      return {};
  }
}

function toItem(row: ModerationRow, storeName: string | null): ModerationProduct {
  const adminDeleted = Boolean(row.deletedAt) && row.deletedBy?.role === 'admin';
  return {
    storeId: String(row.store),
    storeName,
    productId: String(row._id),
    title: row.title,
    slug: row.slug,
    status: moderationStatusOf(row),
    takedownReason: row.moderation?.reason ?? null,
    takenDownAt: iso(row.moderation?.takenDownAt),
    adminDeleted,
    deleteReason: adminDeleted ? (row.deletedBy?.reason ?? null) : null,
    deletedAt: iso(row.deletedAt),
    createdAt: iso(row.createdAt) ?? '',
    updatedAt: iso(row.updatedAt) ?? '',
  };
}

/** Store names only: an operator sees which store, and nothing about the seller behind it. */
async function storeNames(rows: readonly ModerationRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => String(row.store)))];
  if (ids.length === 0) return new Map();
  const stores = (await Store.find({ _id: { $in: ids } }).select('name').lean()) as unknown as Array<{ _id: unknown; name?: string }>;
  return new Map(stores.map((store) => [String(store._id), store.name ?? '']));
}

async function toSingleItem(row: ModerationRow): Promise<ModerationProduct> {
  return toItem(row, (await storeNames([row])).get(String(row.store)) ?? null);
}

async function loadRow(productId: string): Promise<ModerationRow> {
  const row = (await Product.findOne({ _id: productId }).select(FIELDS).lean()) as unknown as ModerationRow | null;
  if (!row) throw productNotFound();
  return row;
}

/**
 * The entry goes in before the change. A failed entry stops the action, and a retry then simply runs it, so no action can
 * ever happen unrecorded. The price is that a write failing right after leaves an entry for a change that did not land.
 */
async function audit(action: string, row: ModerationRow, adminId: string, reason: string | null): Promise<void> {
  await writeAuditLog('product.' + action, 'product', String(row._id), 'admin:' + adminId, {
    storeId: String(row.store),
    productId: String(row._id),
    reason,
    at: new Date().toISOString(),
  });
}

export async function listModerationProducts(query: ModerationProductListQuery): Promise<ModerationProductList> {
  assertCan('admin', 'read', 'productModeration');
  const filter: Record<string, unknown> = {
    ...statusFilter(query.status),
    ...(query.storeId ? { store: query.storeId } : {}),
    ...(query.q ? { title: { $regex: escapeRegex(query.q), $options: 'i' } } : {}),
  };
  const [rows, totalDocs] = await Promise.all([
    Product.find(filter)
      .select(FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<ModerationRow[]>,
    Product.countDocuments(filter),
  ]);
  const names = await storeNames(rows);
  return {
    docs: rows.map((row) => toItem(row, names.get(String(row.store)) ?? null)),
    page: query.page,
    limit: query.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / query.limit),
  };
}

/** Takes a product off Live at once. isPublished is left alone, so a restore needs nothing else to return it as it was. */
export async function takedownProduct(input: { productId: string; reason: string }, adminId: string): Promise<ModerationProduct> {
  assertCan('admin', 'update', 'productModeration');
  const row = await loadRow(input.productId);
  if (row.moderation) return toSingleItem(row);

  await audit('takedown', row, adminId, input.reason);
  const updated = (await Product.findOneAndUpdate(
    { _id: input.productId, moderation: null },
    { $set: { moderation: { state: 'takedown', reason: input.reason, takenDownBy: adminId, takenDownAt: new Date() } } },
    { new: true },
  )
    .select(FIELDS)
    .lean()) as unknown as ModerationRow | null;

  await revalidateStoreProduct(String(row.store), input.productId);
  return toSingleItem(updated ?? (await loadRow(input.productId)));
}

/**
 * Undoes what moderation did, in one step: a takedown is cleared, and an admin's delete is undone, so the product returns
 * as it was before and the D-040 lock is gone. A seller's own trash is the seller's: it stays in trash.
 */
export async function restoreModeratedProduct(input: { productId: string }, adminId: string): Promise<ModerationProduct> {
  assertCan('admin', 'update', 'productModeration');
  const row = await loadRow(input.productId);
  const adminDeleted = Boolean(row.deletedAt) && row.deletedBy?.role === 'admin';
  if (!row.moderation && !adminDeleted) {
    throw new ProductRequestError(409, 'PRODUCT_NOT_MODERATED', 'This product has no takedown or admin delete to undo.');
  }

  await audit('restore', row, adminId, null);
  const set: Record<string, unknown> = { moderation: null };
  if (adminDeleted) Object.assign(set, { deletedAt: null, deletedBy: null, isPublished: row.deletedBy?.wasPublished === true });
  const updated = (await Product.findOneAndUpdate({ _id: input.productId }, { $set: set }, { new: true })
    .select(FIELDS)
    .lean()) as unknown as ModerationRow | null;
  if (!updated) throw productNotFound();

  await revalidateStoreProduct(String(row.store), input.productId);
  return toSingleItem(updated);
}

/** An admin's soft delete. deletedBy marks it, so D-040 keeps the seller out, and remembers what a restore must return to. */
export async function deleteModeratedProduct(input: { productId: string; reason: string }, adminId: string): Promise<ModerationProduct> {
  assertCan('admin', 'delete', 'productModeration');
  const row = await loadRow(input.productId);
  if (row.deletedAt) {
    if (row.deletedBy?.role === 'admin') return toSingleItem(row);
    throw new ProductRequestError(409, 'PRODUCT_IN_SELLER_TRASH', 'The seller already moved this product to trash. Take it down, or delete it permanently.');
  }

  await audit('delete', row, adminId, input.reason);
  const updated = (await Product.findOneAndUpdate(
    { _id: input.productId, deletedAt: null },
    {
      $set: {
        deletedAt: new Date(),
        deletedBy: { user: adminId, role: 'admin', wasPublished: row.isPublished === true, reason: input.reason },
        isPublished: false,
      },
    },
    { new: true },
  )
    .select(FIELDS)
    .lean()) as unknown as ModerationRow | null;
  if (!updated) throw new ProductRequestError(409, 'PRODUCT_CHANGED', 'This product changed. Reload and try again.');

  await revalidateStoreProduct(String(row.store), input.productId);
  return toSingleItem(updated);
}

/** Only from trash (A-003), through the seller's own purge: reviews are archived, and Media rows are never touched. */
export async function purgeModeratedProduct(input: { productId: string; reason: string }, adminId: string): Promise<{ deleted: true; productId: string }> {
  assertCan('admin', 'delete', 'productModeration');
  const row = await loadRow(input.productId);
  if (!row.deletedAt) throw new ProductRequestError(409, 'PRODUCT_NOT_IN_TRASH', 'Move this product to trash first.');

  await audit('permanent-delete', row, adminId, input.reason);
  if (!(await purgeProduct(row, new Date()))) throw productNotFound();
  await revalidateStoreProduct(String(row.store), input.productId);
  return { deleted: true, productId: input.productId };
}

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

interface BodySchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/** The route of one POST action: the signature first, then the body, and only then the database. */
export async function moderationAction<T, R>(request: NextRequest, schema: BodySchema<T>, run: (input: T, adminId: string) => Promise<R>): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;

    let raw: unknown = null;
    try {
      raw = JSON.parse(signed.rawBody);
    } catch {
      raw = null;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({ message: issue.message, code: 'INVALID_REQUEST', path: issue.path.map(String).join('.') }));
      return NextResponse.json({ errors }, { status: 422, headers: NO_STORE });
    }

    await requireDatabase();
    return NextResponse.json(await run(parsed.data, signed.adminId), { headers: NO_STORE });
  } catch (err) {
    return handleProductError(err);
  }
}

/** GET /api/internal/moderation/products. Read-only, across stores. */
export async function moderationList(request: NextRequest): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;

    const parsed = moderationProductListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ errors: [{ message: 'Check the filters and try again.', code: 'INVALID_REQUEST' }] }, { status: 422, headers: NO_STORE });
    }
    await requireDatabase();
    return NextResponse.json(await listModerationProducts(parsed.data), { headers: NO_STORE });
  } catch (err) {
    return handleProductError(err);
  }
}

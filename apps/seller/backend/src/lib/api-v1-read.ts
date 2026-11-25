import type { NextResponse } from 'next/server';
import type { ApiV1Order, ApiV1Product } from '@markaz/contracts';
import { cutPage, isV1Id, PAGE_SORT, pageFilter, parseListQuery, v1Json, v1NotFound, type V1Caller } from '@/lib/api-v1';
import { Category, Media, Order, Product } from '@/lib/services';

/*
 * Sprint 8 (S8-B5, D-118): what v1 answers. Every read names the store of the KEY (never anything from the request), and every answer is built field by field, so
 * nothing internal can slip in. Orders are read with a projection that leaves the customer's name, phone, email and address in the database: only the city is read.
 */

type Row = Record<string, any>;

export const PRODUCT_V1_SELECT = 'title slug description minPrice variants.price variants.compareAtPrice variants.trackQuantity variants.stockQuantity isPublished moderation categories media createdAt updatedAt';
export const ORDER_V1_SELECT = 'orderId status paymentMethod paymentStatus items subtotal deliveryCharges discountAmount taxAmount total city createdAt updatedAt';

const rupees = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
const iso = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0);
  return (Number.isNaN(date.getTime()) ? new Date(0) : date).toISOString();
};

// ---------------------------------------------------------------------------------------------------------------------
// Products

interface Lookups {
  categories: Map<string, Row>;
  media: Map<string, Row>;
}

/** The categories and pictures the rows name, each read within the key's store. */
async function lookupsFor(storeId: string, rows: Row[]): Promise<Lookups> {
  const categoryIds = [...new Set(rows.flatMap((row) => (Array.isArray(row.categories) && row.categories.length > 0 ? [String(row.categories[0])] : [])))];
  const mediaIds = [...new Set(rows.flatMap((row) => (Array.isArray(row.media) ? row.media.map(String) : [])))];
  const [categories, media] = await Promise.all([
    categoryIds.length === 0 ? [] : (Category.find({ store: storeId, _id: { $in: categoryIds } } as never).select('name slug').lean() as unknown as Promise<Row[]>),
    mediaIds.length === 0 ? [] : (Media.find({ store: storeId, _id: { $in: mediaIds } } as never).select('url alt resourceType').lean() as unknown as Promise<Row[]>),
  ]);
  return {
    categories: new Map(categories.map((row) => [String(row._id), row])),
    media: new Map(media.map((row) => [String(row._id), row])),
  };
}

export function toV1Product(row: Row, lookups: Lookups): ApiV1Product {
  const variants = list(row.variants);
  const price = rupees(row.minPrice);
  const cheapest = variants.find((variant) => rupees(variant.price) === price);
  const compare = typeof cheapest?.compareAtPrice === 'number' ? rupees(cheapest.compareAtPrice) : null;
  const tracked = variants.every((variant) => variant.trackQuantity !== false);
  const categoryId = Array.isArray(row.categories) && row.categories.length > 0 ? String(row.categories[0]) : null;
  const category = categoryId === null ? undefined : lookups.categories.get(categoryId);
  return {
    id: String(row._id),
    name: text(row.title),
    slug: text(row.slug),
    description: textOrNull(row.description),
    price,
    comparePrice: compare !== null && compare > price ? compare : null,
    stock: tracked ? variants.reduce((sum, variant) => sum + rupees(variant.stockQuantity), 0) : null,
    status: row.moderation ? 'taken_down' : row.isPublished === true ? 'published' : 'draft',
    category: category ? { id: String(category._id), name: text(category.name), slug: text(category.slug) } : null,
    images: (Array.isArray(row.media) ? row.media : []).flatMap((id: unknown) => {
      const file = lookups.media.get(String(id));
      return file && file.resourceType !== 'video' && textOrNull(file.url) ? [{ url: text(file.url), alt: text(file.alt) }] : [];
    }),
    updatedAt: iso(row.updatedAt),
  };
}

/** Trashed products are not part of v1. */
const productsOf = (storeId: string): Record<string, unknown> => ({ store: storeId, deletedAt: null });

export async function listV1Products(caller: V1Caller, params: URLSearchParams): Promise<NextResponse> {
  const parsed = parseListQuery(params);
  if (!parsed.ok) return parsed.response;
  const found = (await Product.find(pageFilter(productsOf(caller.storeId), parsed.query) as never)
    .select(PRODUCT_V1_SELECT)
    .sort(PAGE_SORT)
    .limit(parsed.query.limit + 1)
    .lean()) as unknown as Array<Row & { _id: unknown }>;
  const page = cutPage(found, parsed.query.limit);
  const lookups = await lookupsFor(caller.storeId, page.rows);
  return v1Json({ data: page.rows.map((row) => toV1Product(row, lookups)), nextCursor: page.nextCursor });
}

export async function readV1Product(caller: V1Caller, id: string): Promise<NextResponse> {
  if (!isV1Id(id)) return v1NotFound();
  const row = (await Product.findOne({ _id: id, ...productsOf(caller.storeId) } as never).select(PRODUCT_V1_SELECT).lean()) as unknown as Row | null;
  if (!row) return v1NotFound();
  return v1Json({ data: toV1Product(row, await lookupsFor(caller.storeId, [row])) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders

export function toV1Order(row: Row): ApiV1Order {
  return {
    id: String(row._id),
    orderId: text(row.orderId),
    status: text(row.status) || 'pending',
    paymentMethod: textOrNull(row.paymentMethod),
    // An order from before payment states has none: unpaid.
    paymentStatus: text(row.paymentStatus) || 'unpaid',
    items: list(row.items).map((item) => ({
      productId: text(item.productId),
      variantId: text(item.variantId),
      name: text(item.productTitle),
      variantName: text(item.variantTitle),
      sku: textOrNull(item.sku),
      unitPrice: rupees(item.unitPrice),
      quantity: Math.max(1, rupees(item.quantity)),
    })),
    subtotal: rupees(row.subtotal),
    deliveryCharges: rupees(row.deliveryCharges),
    discount: rupees(row.discountAmount),
    taxAmount: rupees(row.taxAmount),
    total: rupees(row.total),
    city: textOrNull(row.city),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listV1Orders(caller: V1Caller, params: URLSearchParams): Promise<NextResponse> {
  const parsed = parseListQuery(params);
  if (!parsed.ok) return parsed.response;
  const found = (await Order.find(pageFilter({ store: caller.storeId }, parsed.query) as never)
    .select(ORDER_V1_SELECT)
    .sort(PAGE_SORT)
    .limit(parsed.query.limit + 1)
    .lean()) as unknown as Array<Row & { _id: unknown }>;
  const page = cutPage(found, parsed.query.limit);
  return v1Json({ data: page.rows.map(toV1Order), nextCursor: page.nextCursor });
}

export async function readV1Order(caller: V1Caller, id: string): Promise<NextResponse> {
  if (!isV1Id(id)) return v1NotFound();
  const row = (await Order.findOne({ _id: id, store: caller.storeId } as never).select(ORDER_V1_SELECT).lean()) as unknown as Row | null;
  if (!row) return v1NotFound();
  return v1Json({ data: toV1Order(row) });
}

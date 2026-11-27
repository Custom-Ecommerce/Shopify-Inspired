import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate, type AuthContext } from '@/lib/auth';
import { MOBILE_PAGE_DEFAULT, MOBILE_PAGE_MAX } from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { revisionOf, RevisionConflictError, stampOf } from '@/lib/mobile-revision';
import { connectSellerDb } from '@/lib/mongo';
import { handleOrderError, OrderRequestError, toDashboardOrderDetail, toDashboardOrderListItem } from '@/lib/orders';
import { handleProductError, loadSellerProduct, ProductRequestError } from '@/lib/products';
import { ProductVariantError } from '@/lib/product-variants';

/*
 * Sprint 9 (EP-31.US03): what the phone routes share: the database, the wire shapes with their revision, and the error answers. The business rules stay in
 * the libs the portal routes use.
 */

export const MOBILE_HEADERS = { 'Cache-Control': 'no-store' };
export { MOBILE_PAGE_DEFAULT, MOBILE_PAGE_MAX };

export const mobileJson = (body: unknown, status: number = 200): Response => NextResponse.json(body, { status, headers: MOBILE_HEADERS });

/** A phone user signed in as a seller; the app is for sellers only (an operator's web token is refused too). */
export async function requireSellerApp(request: NextRequest): Promise<AuthContext> {
  const ctx = await authenticate(request);
  if (ctx.actor !== 'seller') throw new HttpError(403, 'The seller app is for seller accounts');
  return ctx;
}

export async function mobileDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

export function recordId(id: string, what: string): string {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, what + ' not found');
  return id;
}

export function pageNumbers(totalDocs: number, page: number, limit: number): { page: number; limit: number; totalDocs: number; totalPages: number } {
  return { page, limit, totalDocs, totalPages: Math.ceil(totalDocs / limit) };
}

/** Parses a JSON body with a contract schema: 400 naming the field, as the order routes answer. */
export async function readMobileBody(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  return raw as Record<string, unknown>;
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string; keys?: unknown[] }> } };
}

export function parseMobile<T>(raw: unknown, schema: Schema<T>): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? issue.path.map(String).join('.') : issue?.keys?.length ? String(issue.keys[0]) : null;
  throw new HttpError(400, (field ? field + ': ' : '') + (issue?.message ?? 'Invalid body.'), 'MOBILE_BODY_INVALID', field ?? 'body');
}

// ---------------------------------------------------------------------------------------------------------------------
// Wire shapes

export const mobileOrderItem = (row: unknown) => ({ ...toDashboardOrderListItem(row), ...stampOf(row) });
export const mobileOrderDetail = (row: unknown) => ({ ...toDashboardOrderDetail(row), ...stampOf(row) });

/** One product of the store as the app shows it: the portal's detail, and the product's revision on it and on each variant. */
export async function mobileProductDetail(storeId: string, productId: string) {
  const detail = await loadSellerProduct(storeId, productId);
  const stamp = { revision: revisionOf(detail.updatedAt), updatedAt: new Date(revisionOf(detail.updatedAt) || revisionOf(detail.createdAt)).toISOString() };
  return {
    id: detail.id,
    title: detail.title,
    status: detail.status,
    minPrice: detail.minPrice,
    totalStock: detail.totalStock,
    stockStatus: detail.stockStatus,
    variantCount: detail.variantCount,
    imageUrl: detail.imageUrl,
    description: detail.description,
    variants: detail.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      trackQuantity: variant.trackQuantity,
      stockQuantity: variant.stockQuantity,
      availability: variant.availability,
      ...stamp,
    })),
    media: detail.media,
    ...stamp,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors

export function mobileError(err: unknown): Response {
  if (err instanceof OrderRequestError) return handleOrderError(err);
  if (err instanceof ProductRequestError || err instanceof ProductVariantError) return handleProductError(err);
  return handleRouteError(err);
}

/** 409 CONFLICT with the record as it is now, in the same shape the read routes answer. */
export function conflictResponse(current: unknown): Response {
  const conflict = new RevisionConflictError();
  return mobileJson({ errors: [{ message: conflict.message }], code: 'CONFLICT', current }, 409);
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { mediaUploadFieldsSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, Media } from '@/lib/services';
import { plainDoc, requireSellerStoreId, toWire } from '@/lib/seller-scope';
import { uploadImage } from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024;

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/** GET /api/media. The store's media records, newest first, in the list envelope. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'media');
    const params = request.nextUrl.searchParams;
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);

    await requireDatabase();
    const storeId = await requireSellerStoreId(ctx);
    const filter = { store: storeId };

    const [rows, totalDocs] = await Promise.all([
      Media.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Media.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => toWire(plainDoc(row)));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/media. Multipart: a file and alt. The image is uploaded to Cloudinary under the store's folder, and
 * the record is stored for the seller's store. Other types are refused with 415, oversize files with 413.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);

    const form = await request.formData().catch(() => null);
    if (form === null) return jsonError(422, 'multipart form data is required');
    const file = form.get('file');
    if (!(file instanceof Blob)) return jsonError(422, 'file is required');
    const fields = mediaUploadFieldsSchema.safeParse({ alt: form.get('alt') });
    if (!fields.success) return jsonError(422, 'alt is required (1 to 200 characters)');
    if (!ALLOWED_TYPES.includes(file.type)) return jsonError(415, 'unsupported image type');
    if (file.size > MAX_BYTES) return jsonError(413, 'image is larger than 10 MB');

    assertCan(ctx.actor, 'create', 'media', ['alt']);
    await requireDatabase();
    const storeId = await requireSellerStoreId(ctx);

    const uploaded = await uploadImage(file);
    const created = await Media.create({
      store: storeId,
      alt: fields.data.alt,
      url: uploaded.url,
      cloudinaryPublicId: uploaded.publicId,
      cloudinaryResourceType: uploaded.resourceType,
      mimeType: file.type,
      filesize: file.size,
      width: uploaded.width,
      height: uploaded.height,
    });
    return NextResponse.json(toWire(plainDoc(created)), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

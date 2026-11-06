import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  MEDIA_VIDEO_FORMATS,
  MEDIA_VIDEO_MAX_BYTES,
  MEDIA_VIDEO_MAX_SECONDS,
  MEDIA_VIDEO_MIME_TYPES,
  mediaUploadFieldsSchema,
} from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, handleRouteError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, listEnvelope, Media } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';
import { deleteVideo, uploadImage, uploadVideo, type UploadedVideo } from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024;

const refusal = (status: number, code: string, message: string): NextResponse =>
  NextResponse.json({ errors: [{ message, code }] }, { status });

/** What Cloudinary found wrong with a file it already stored, or null. Its answer is the truth, not the browser's label. */
function videoRefusal(video: UploadedVideo): NextResponse | null {
  const formats: readonly string[] = MEDIA_VIDEO_FORMATS;
  if (video.format === null || !formats.includes(video.format.toLowerCase())) {
    return refusal(415, 'MEDIA_VIDEO_FORMAT', 'Use an MP4, WebM or MOV video.');
  }
  if (video.bytes > MEDIA_VIDEO_MAX_BYTES) return refusal(413, 'MEDIA_VIDEO_TOO_LARGE', 'A video can be at most 50 MB.');
  if (video.duration === null) return refusal(422, 'MEDIA_VIDEO_UNREADABLE', 'We could not read the length of this video.');
  if (video.duration > MEDIA_VIDEO_MAX_SECONDS) {
    return refusal(422, 'MEDIA_VIDEO_TOO_LONG', 'A video can be at most ' + MEDIA_VIDEO_MAX_SECONDS + ' seconds long.');
  }
  return null;
}

/** Uploads, judges, and only then records. A refused or unrecorded file does not stay in Cloudinary. */
async function createVideo(storeId: string, alt: string, file: Blob): Promise<Response> {
  const uploaded = await uploadVideo(file);
  const refused = videoRefusal(uploaded);
  if (refused !== null) {
    await deleteVideo(uploaded.publicId);
    return refused;
  }
  try {
    const created = await Media.create({
      store: storeId,
      alt,
      url: uploaded.url,
      cloudinaryPublicId: uploaded.publicId,
      cloudinaryResourceType: uploaded.resourceType,
      resourceType: 'video',
      mimeType: file.type,
      filesize: file.size,
      width: uploaded.width,
      height: uploaded.height,
      duration: uploaded.duration,
      bytes: uploaded.bytes,
      format: uploaded.format,
      posterUrl: uploaded.posterUrl,
    });
    return NextResponse.json(toWire(plainDoc(created)), { status: 201 });
  } catch (err) {
    await deleteVideo(uploaded.publicId);
    throw err;
  }
}

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
    const storeId = await resolveOwnedStoreId(request, ctx, null);
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
 *
 * A video (MP4, WebM or MOV, up to 50 MB) takes the same path. Its length is read from Cloudinary's answer, never from the
 * client: 422 MEDIA_VIDEO_TOO_LONG past 60 seconds, and the uploaded file is deleted from Cloudinary again.
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
    const isVideo = file.type.startsWith('video/');
    if (isVideo) {
      const types: readonly string[] = MEDIA_VIDEO_MIME_TYPES;
      if (!types.includes(file.type)) return refusal(415, 'MEDIA_VIDEO_FORMAT', 'Use an MP4, WebM or MOV video.');
      if (file.size > MEDIA_VIDEO_MAX_BYTES) return refusal(413, 'MEDIA_VIDEO_TOO_LARGE', 'A video can be at most 50 MB.');
    } else {
      if (!ALLOWED_TYPES.includes(file.type)) return jsonError(415, 'unsupported image type');
      if (file.size > MAX_BYTES) return jsonError(413, 'image is larger than 10 MB');
    }

    assertCan(ctx.actor, 'create', 'media', ['alt']);
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    if (isVideo) return await createVideo(storeId, fields.data.alt, file);

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

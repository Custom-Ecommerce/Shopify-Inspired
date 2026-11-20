import { createHash } from 'node:crypto';
import { HttpError } from '@/lib/http';

export interface UploadedImage {
  url: string;
  publicId: string;
  resourceType: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

/**
 * Cloudinary's upload signature: the parameters sorted by name as key=value joined by &, with the API secret
 * appended, hashed with SHA-1.
 */
export function signParams(params: Record<string, string>, secret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => key + '=' + params[key])
    .join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new HttpError(503, 'Image storage is not configured');
  return value;
}

interface UploadAnswer {
  secure_url?: string;
  public_id?: string;
  resource_type?: string;
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
  format?: string;
}

/** One signed upload to the configured Cloudinary folder. Only signed parameters are sent. */
async function upload(file: Blob, resource: 'image' | 'video'): Promise<UploadAnswer & { secure_url: string; public_id: string }> {
  const label = resource === 'image' ? 'Image' : 'Video';
  const cloud = requireEnv('CLOUDINARY_CLOUD_NAME');
  const apiKey = requireEnv('CLOUDINARY_API_KEY');
  const secret = requireEnv('CLOUDINARY_API_SECRET');
  const folder = process.env.CLOUDINARY_FOLDER || 'markaz';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signParams({ folder, timestamp }, secret);

  const form = new FormData();
  form.append('file', file, 'upload');
  form.append('api_key', apiKey);
  form.append('folder', folder);
  form.append('timestamp', timestamp);
  form.append('signature', signature);

  const res = await fetch('https://api.cloudinary.com/v1_1/' + cloud + '/' + resource + '/upload', { method: 'POST', body: form });
  if (!res.ok) throw new HttpError(502, label + ' upload was refused');
  const json = (await res.json()) as UploadAnswer;
  if (!json.secure_url || !json.public_id) throw new HttpError(502, label + ' upload returned no address');
  return { ...json, secure_url: json.secure_url, public_id: json.public_id };
}

/** Uploads one image. */
export async function uploadImage(file: Blob): Promise<UploadedImage> {
  const json = await upload(file, 'image');
  return {
    url: json.secure_url,
    publicId: json.public_id,
    resourceType: json.resource_type ?? 'image',
    width: json.width ?? null,
    height: json.height ?? null,
    bytes: json.bytes ?? 0,
  };
}

export interface UploadedVideo {
  url: string;
  publicId: string;
  resourceType: string;
  width: number | null;
  height: number | null;
  bytes: number;
  format: string | null;
  /** Seconds, as Cloudinary measured the file. Null when it could not say. */
  duration: number | null;
  posterUrl: string;
}

/** Uploads one video. Cloudinary serves a frame of any video under the same address with an image extension. */
export async function uploadVideo(file: Blob): Promise<UploadedVideo> {
  const json = await upload(file, 'video');
  return {
    url: json.secure_url,
    publicId: json.public_id,
    resourceType: json.resource_type ?? 'video',
    width: json.width ?? null,
    height: json.height ?? null,
    bytes: json.bytes ?? 0,
    format: json.format ?? null,
    duration: typeof json.duration === 'number' && Number.isFinite(json.duration) ? json.duration : null,
    posterUrl: json.secure_url.replace(/\.[a-z0-9]+$/i, '.jpg'),
  };
}

/**
 * Deletes one asset from Cloudinary (Sprint 4: images too, for a replaced logo or banner and the media delete route). It
 * reports rather than throws: the seller's action already happened, and a failure is logged so the leftover can be found.
 */
export async function deleteAsset(publicId: string, resource: 'image' | 'video'): Promise<boolean> {
  try {
    const cloud = requireEnv('CLOUDINARY_CLOUD_NAME');
    const apiKey = requireEnv('CLOUDINARY_API_KEY');
    const secret = requireEnv('CLOUDINARY_API_SECRET');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { invalidate: 'true', public_id: publicId, timestamp };

    const form = new FormData();
    for (const [name, value] of Object.entries(params)) form.append(name, value);
    form.append('api_key', apiKey);
    form.append('signature', signParams(params, secret));

    const res = await fetch('https://api.cloudinary.com/v1_1/' + cloud + '/' + resource + '/destroy', { method: 'POST', body: form });
    const json = (await res.json().catch(() => null)) as { result?: string } | null;
    if (res.ok && json?.result === 'ok') return true;
    console.error('[seller-backend] a Cloudinary asset was not deleted', { publicId, resource });
    return false;
  } catch {
    console.error('[seller-backend] a Cloudinary asset was not deleted', { publicId, resource });
    return false;
  }
}

/** Deletes a video from Cloudinary, for a file that was uploaded and then refused. Never throws. */
export async function deleteVideo(publicId: string): Promise<boolean> {
  return deleteAsset(publicId, 'video');
}

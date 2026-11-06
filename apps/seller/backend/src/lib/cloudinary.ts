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

/** Uploads one image to the configured Cloudinary folder. Only signed parameters are sent. */
export async function uploadImage(file: Blob): Promise<UploadedImage> {
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

  const res = await fetch('https://api.cloudinary.com/v1_1/' + cloud + '/image/upload', { method: 'POST', body: form });
  if (!res.ok) throw new HttpError(502, 'Image upload was refused');
  const json = (await res.json()) as {
    secure_url?: string;
    public_id?: string;
    resource_type?: string;
    width?: number;
    height?: number;
    bytes?: number;
  };
  if (!json.secure_url || !json.public_id) throw new HttpError(502, 'Image upload returned no address');
  return {
    url: json.secure_url,
    publicId: json.public_id,
    resourceType: json.resource_type ?? 'image',
    width: json.width ?? null,
    height: json.height ?? null,
    bytes: json.bytes ?? 0,
  };
}

/**
 * A product photo at about the size it is shown. A Cloudinary address gets a resize transformation (so a list does not download full photos); any other
 * address is used as it is. Only https is loaded.
 */
export function sizedImageUrl(url: string | null | undefined, pixels: number): string | null {
  if (!url || !url.startsWith('https://')) return null;
  const match = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/.exec(url);
  if (!match) return url;
  const size = Math.max(1, Math.round(pixels));
  return `${match[1]}c_limit,w_${size},h_${size},q_auto,f_auto/${match[2]}`;
}

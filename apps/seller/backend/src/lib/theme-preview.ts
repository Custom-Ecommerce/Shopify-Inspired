/**
 * Sprint 7 (S7-B1, CO-81): the address of a theme's preview image. The images are static files of the storefront app (apps/storefront/public), so with a
 * usable STOREFRONT_URL the path becomes an absolute address on the storefront's origin (the dashboard is on another origin). Without one the path is
 * sent as it is. No path (a theme without a preview) is null.
 */
export function previewImageUrl(path: string | undefined | null, storefrontUrl: string | undefined | null): string | null {
  if (path === undefined || path === null || path === '') return null;
  try {
    // The caller passes the setting (process.env.STOREFRONT_URL); an undefined here means "none", never "read the environment".
    return new URL(path, storefrontUrl ?? '').toString();
  } catch {
    return path;
  }
}

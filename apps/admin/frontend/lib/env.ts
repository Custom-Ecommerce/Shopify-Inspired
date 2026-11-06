/** The admin backend's base URL without a trailing slash, or null when it is not configured. Server side only. */
export function backendBaseUrl(): string | null {
  const raw = process.env.ADMIN_BACKEND_API_URL;
  if (raw === undefined || raw.trim() === "") return null;
  return raw.trim().replace(/\/+$/, "");
}

import { API_KEY_NAME_MAX, API_KEY_SCOPES, type ApiKeyScope, type ApiKeyView } from "@markaz/contracts/api-keys";

/**
 * Sprint 8 (S8-B4, D-118): the API keys page. Pure: the words, the form checks, and what a key row says. The secret of a new key is held only in the page's
 * memory while it is shown; nothing here (and nothing on the page) stores it.
 */

export { API_KEY_NAME_MAX, API_KEY_SCOPES };

export const SCOPE_COPY: Record<ApiKeyScope, { name: string; help: string }> = {
  "products:read": { name: "Read products", help: "List and read the store's products." },
  "orders:read": { name: "Read orders", help: "List and read the store's orders. Of the customer, only the city: no name, phone, email or address." },
};

/** Where the portal serves the API documentation (public/docs/api-v1.md, a copy of docs/api-v1.md). */
export const API_DOCS_HREF = "/docs/api-v1.md";

export const SECRET_ONCE_NOTE = "Copy it now. You will not see it again: Markazify keeps only a fingerprint of it, so a lost key has to be revoked and replaced.";

export function createProblems(form: { name: string; scopes: readonly string[] }): Record<string, string> {
  const out: Record<string, string> = {};
  const name = form.name.trim();
  if (name === "") out.name = "Give the key a name, for example the app that will use it.";
  else if (name.length > API_KEY_NAME_MAX) out.name = `The name can be at most ${API_KEY_NAME_MAX} characters.`;
  else if (/[<>]/.test(name)) out.name = "The name cannot contain < or >.";
  if (form.scopes.length === 0) out.scopes = "Choose at least one permission.";
  else if (form.scopes.some((scope) => !(API_KEY_SCOPES as readonly string[]).includes(scope))) out.scopes = "Choose a permission from the list.";
  return out;
}

export const toggleScope = (scopes: readonly ApiKeyScope[], scope: ApiKeyScope, on: boolean): ApiKeyScope[] =>
  API_KEY_SCOPES.filter((item) => (item === scope ? on : scopes.includes(item)));

export const isLive = (key: Pick<ApiKeyView, "revokedAt">): boolean => key.revokedAt === null;

const day = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

export function keyStatusText(key: Pick<ApiKeyView, "revokedAt">): string {
  return key.revokedAt === null ? "Active" : `Revoked ${day(key.revokedAt)}`;
}

export const lastUsedText = (key: Pick<ApiKeyView, "lastUsedAt">): string => (key.lastUsedAt === null ? "Never used" : `Last used ${day(key.lastUsedAt)}`);

export const createdText = (key: Pick<ApiKeyView, "createdAt">): string => `Created ${day(key.createdAt)}`;

export const scopesText = (scopes: readonly ApiKeyScope[]): string => scopes.map((scope) => SCOPE_COPY[scope]?.name ?? scope).join(", ");

export function keyUsageText(usage: { used: number; limit: number | null }): string {
  if (usage.limit === null) return `${usage.used} active ${usage.used === 1 ? "key" : "keys"}`;
  return `${usage.used} of ${usage.limit} ${usage.limit === 1 ? "key" : "keys"} in use`;
}

export const revokeConfirmText = (key: Pick<ApiKeyView, "name">): string =>
  `Anything using "${key.name}" stops working at once. This cannot be undone; create a new key if you need one.`;

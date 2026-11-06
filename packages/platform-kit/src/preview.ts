/**
 * Seller preview mode (D-018, D-019). The names both sides of the preview have to agree on. Pure: no I/O, no secrets, so
 * the storefront's edge middleware, the data layer and the seller backend all read this one definition.
 */

/** The link from the dashboard carries the token here once. The storefront moves it to the cookie and strips it. */
export const PREVIEW_QUERY_PARAM = "preview";

/** httpOnly and host-only: no Domain attribute, so a browser sends it to the one store host that set it. */
export const PREVIEW_COOKIE_NAME = "markaz-preview";

/** How the credential travels from the storefront to the seller backend. Always a header, never a query string. */
export const PREVIEW_CREDENTIAL_HEADER = "x-markaz-preview";

/** The token's purpose claim, so a token signed for anything else cannot open a preview. */
export const PREVIEW_PURPOSE = "preview";

/** D-019: each click mints a token valid for 24 hours. */
export const PREVIEW_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const TOKEN_MAX_LENGTH = 2048;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Could this be a token at all? Says nothing about its validity: it keeps junk out of cookies and request headers. */
export function isPreviewTokenShape(value: unknown): value is string {
  return typeof value === "string" && value.length <= TOKEN_MAX_LENGTH && TOKEN_SHAPE.test(value);
}

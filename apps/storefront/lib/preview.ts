import "server-only";

import { headers } from "next/headers";
import { PREVIEW_CREDENTIAL_HEADER, isPreviewTokenShape } from "@markaz/platform-kit/preview";

/**
 * The preview token of this request, or null. Middleware is the only writer of this header: it removes whatever a browser
 * sent and copies the cookie in. It says nothing about validity, which the seller backend decides on every call. The value
 * is a credential: pass it to the transport, never to a client component or a log.
 */
export async function requestPreviewToken(): Promise<string | null> {
  const value = (await headers()).get(PREVIEW_CREDENTIAL_HEADER);
  return isPreviewTokenShape(value) ? value : null;
}

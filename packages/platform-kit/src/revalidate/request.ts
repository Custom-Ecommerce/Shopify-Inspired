/**
 * Pure builder for the revalidation request (report §4.7, fixes F1/F3).
 *
 * Transport: `POST {storefront}/api/revalidate`, secret in the
 * `x-revalidate-secret` header, body `{ "tags": string[] }`. The secret is never
 * placed in the URL, so it cannot reach proxy or access logs.
 *
 * This module only builds the request. Each backend performs the fetch, the
 * retry, and the logging, and must never log `request.init.headers`.
 */
import {
  REVALIDATE_PATH,
  REVALIDATE_SECRET_HEADER,
  validateRevalidateTags,
} from "./tags";

export interface RevalidateRequest {
  readonly url: string;
  readonly init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  };
}

export type BuildRevalidateRequestResult =
  | { readonly ok: true; readonly request: RevalidateRequest }
  | {
      readonly ok: false;
      readonly reason:
        | "MISSING_CONFIG"
        | "INVALID_URL"
        | "MISSING_TAGS"
        | "TOO_MANY_TAGS"
        | "INVALID_TAG";
      readonly invalidTags?: readonly string[];
    };

export interface BuildRevalidateRequestInput {
  /** Storefront origin, optionally with a path prefix. */
  readonly storefrontUrl: string;
  readonly secret: string;
  readonly tags: readonly string[];
}

export function buildRevalidateRequest(input: BuildRevalidateRequestInput): BuildRevalidateRequestResult {
  if (input.storefrontUrl.length === 0 || input.secret.length === 0) {
    return { ok: false, reason: "MISSING_CONFIG" };
  }

  let base: URL;
  try {
    base = new URL(input.storefrontUrl);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return { ok: false, reason: "INVALID_URL" };
  }

  const tagCheck = validateRevalidateTags(input.tags);
  if (!tagCheck.ok) {
    return { ok: false, reason: tagCheck.reason, invalidTags: tagCheck.invalidTags };
  }

  const prefix = base.pathname.replace(/\/+$/, "");
  const url = `${base.origin}${prefix}${REVALIDATE_PATH}`;

  return {
    ok: true,
    request: {
      url,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [REVALIDATE_SECRET_HEADER]: input.secret,
        },
        body: JSON.stringify({ tags: tagCheck.tags }),
      },
    },
  };
}

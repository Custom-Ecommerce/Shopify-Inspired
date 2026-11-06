import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  REVALIDATE_SECRET_HEADER,
  isAllowedRevalidateTag,
  secretsMatch,
  validateRevalidateTags,
} from "@markaz/platform-kit/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cache-purge endpoint called by the seller and admin backends (report §4.7).
 *
 *   POST /api/revalidate
 *   x-revalidate-secret: <REVALIDATE_SECRET>
 *   content-type: application/json
 *   { "tags": ["store:<id>:products", ...] }
 *
 * The secret is compared in constant time. Tags must match the platform-kit
 * allow-list, otherwise the whole batch is rejected with 400.
 *
 * Transitional: the old `?secret=&tag=` query form is still accepted for one
 * release (report F3). It logs a deprecation warning that never includes the
 * secret. Remove it once no caller sends query parameters.
 */
function unauthorized() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Invalid or missing revalidation secret." } },
    { status: 401 },
  );
}

function badRequest(code: string, message: string, invalidTags?: readonly string[]) {
  return NextResponse.json(
    { error: { code, message, ...(invalidTags && invalidTags.length > 0 ? { invalidTags } : {}) } },
    { status: 400 },
  );
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVALIDATE_SECRET;
  const headerSecret = req.headers.get(REVALIDATE_SECRET_HEADER);

  if (headerSecret === null && req.nextUrl.searchParams.has("secret")) {
    console.warn("[revalidate] query-string transport is deprecated; send the x-revalidate-secret header instead");
    if (!secretsMatch(req.nextUrl.searchParams.get("secret"), expected)) return unauthorized();

    const tag = req.nextUrl.searchParams.get("tag");
    if (!isAllowedRevalidateTag(tag)) {
      return badRequest("INVALID_TAG", "Missing or disallowed tag.", tag ? [tag] : []);
    }
    revalidateTag(tag);
    return NextResponse.json({ revalidated: true, count: 1, tags: [tag] });
  }

  if (!secretsMatch(headerSecret, expected)) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("INVALID_BODY", "Request body must be JSON with a `tags` array.");
  }

  const candidate =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).tags : undefined;
  const result = validateRevalidateTags(candidate);
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      MISSING_TAGS: "`tags` must be a non-empty array.",
      TOO_MANY_TAGS: "Too many tags in one request.",
      INVALID_TAG: "One or more tags are not allowed.",
    };
    return badRequest(result.reason, messages[result.reason], result.invalidTags);
  }

  for (const tag of result.tags) {
    revalidateTag(tag);
  }
  return NextResponse.json({ revalidated: true, count: result.tags.length, tags: result.tags });
}

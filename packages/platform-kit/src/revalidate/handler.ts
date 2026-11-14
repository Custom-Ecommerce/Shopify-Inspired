import { REVALIDATE_SECRET_HEADER, validateRevalidateTags } from "./tags";
import { secretsMatch } from "./secret";

export interface RevalidateHandlerDeps {
  /** The expected secret. Unset refuses every request. */
  readonly secret: string | undefined;
  /** Drops one tag from the cache. The storefront passes Next.js's revalidateTag. */
  readonly purge: (tag: string) => void;
}

function refusal(status: number, code: string, message: string, invalidTags?: readonly string[]): Response {
  return Response.json(
    { error: { code, message, ...(invalidTags && invalidTags.length > 0 ? { invalidTags } : {}) } },
    { status },
  );
}

/**
 * The storefront's cache-purge endpoint (report §4.7), free of Next.js so it can be tested.
 *
 *   POST /api/revalidate
 *   x-revalidate-secret: <REVALIDATE_SECRET>
 *   content-type: application/json
 *   { "tags": ["store:<id>:products", ...] }
 *
 * The secret is read from the header only and compared in constant time. Tags must match the allow-list, otherwise the
 * whole batch is refused with 400.
 */
export async function handleRevalidateRequest(request: Request, deps: RevalidateHandlerDeps): Promise<Response> {
  if (!secretsMatch(request.headers.get(REVALIDATE_SECRET_HEADER), deps.secret)) {
    return refusal(401, "UNAUTHORIZED", "Invalid or missing revalidation secret.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal(400, "INVALID_BODY", "Request body must be JSON with a `tags` array.");
  }

  const candidate = typeof body === "object" && body !== null ? (body as Record<string, unknown>).tags : undefined;
  const result = validateRevalidateTags(candidate);
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      MISSING_TAGS: "`tags` must be a non-empty array.",
      TOO_MANY_TAGS: "Too many tags in one request.",
      INVALID_TAG: "One or more tags are not allowed.",
    };
    return refusal(400, result.reason, messages[result.reason], result.invalidTags);
  }

  for (const tag of result.tags) deps.purge(tag);
  return Response.json({ revalidated: true, count: result.tags.length, tags: result.tags });
}

/** The proxy sends `{ error, details }`. A refused field has its own message in details. */
export function refusalMessage(body: unknown, fallback = "Could not save this product."): string {
  const { error, details } = (body ?? {}) as { error?: string; details?: unknown };
  const first = Array.isArray(details) ? (details[0] as { message?: string } | undefined) : undefined;
  return first?.message ?? error ?? fallback;
}

export type ProductAction = "publish" | "unpublish" | "restore";

type StoreFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Runs one action on one product. Null means it worked; otherwise the reason, in words the seller can act on. */
export async function runProductAction(storeFetch: StoreFetch, productId: string, action: ProductAction): Promise<string | null> {
  try {
    const res = await storeFetch(`/api/dashboard/products/${productId}/${action}`, { method: "POST" });
    if (res.ok) return null;
    return refusalMessage(await res.json().catch(() => null), "Could not update this product.");
  } catch {
    return "Could not reach the backend. Please try again.";
  }
}

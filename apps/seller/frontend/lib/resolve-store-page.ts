import "server-only";
import type { ReactNode } from "react";
import { authFailureView } from "@/components/dashboard/WorkspaceNotice";
import { requireStoreContext } from "@/lib/dashboard-auth";
import type { StoreContext } from "@/lib/types/dashboard";

export type StorePageResult =
  | { ok: true; ctx: StoreContext }
  | { ok: false; view: ReactNode };

/**
 * Server pages' entry point under `/s/[storeId]`: validates the URL's
 * `storeId` against the seller's workspace (`requireStoreContext`) and turns
 * auth failures into a redirect or a ready-made view.
 *
 *   const resolved = await resolveStorePage(storeId);
 *   if (!resolved.ok) return resolved.view;
 *   const { token, store } = resolved.ctx;
 *
 * The result is memoised per request through `getDashboardUser` /
 * `getWorkspace` (React `cache`), so calling it in the layout AND the page
 * costs no extra upstream requests.
 */
export async function resolveStorePage(storeId: string): Promise<StorePageResult> {
  try {
    return { ok: true, ctx: await requireStoreContext(storeId) };
  } catch (err) {
    return { ok: false, view: authFailureView(err) };
  }
}

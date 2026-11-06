import { readPage, readSearch } from "@/lib/list-state";
import { PAGE_SIZE } from "@/lib/stores";

export interface SellerListState {
  page: number;
  q: string;
}

export const DEFAULT_SELLER_STATE: SellerListState = { page: 1, q: "" };

export function parseSellerListState(params: { get(name: string): string | null }): SellerListState {
  return { page: readPage(params), q: readSearch(params) };
}

/** The query string for a seller list state. Defaults are left out; the backend call adds the page size. */
export function sellerStateToQuery(state: SellerListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

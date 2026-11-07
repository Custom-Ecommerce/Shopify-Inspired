import type { ModerationProduct, ModerationStatus } from "@/lib/contracts";

export const PRODUCT_PAGE_SIZE = 20;
export const PRODUCT_STATUS_VALUES: readonly ModerationStatus[] = ["live", "draft", "takedown", "trash"];

export interface ProductListState {
  page: number;
  q: string;
  status: ModerationStatus | "";
  storeId: string;
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** Anything unreadable falls back to the default, so a hand-edited URL never breaks the page. */
export function parseProductListState(params: { get(name: string): string | null }): ProductListState {
  const rawPage = params.get("page") ?? "";
  const page = /^\d{1,6}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const rawStatus = params.get("status") ?? "";
  const status = PRODUCT_STATUS_VALUES.find((value) => value === rawStatus) ?? "";
  const rawStore = (params.get("storeId") ?? "").trim();
  return { page, q, status, storeId: OBJECT_ID.test(rawStore) ? rawStore : "" };
}

/** The query string for a list state. Defaults are left out, so the first page of everything is the bare path. */
export function productStateToQuery(state: ProductListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.status !== "") params.set("status", state.status);
  if (state.storeId !== "") params.set("storeId", state.storeId);
  if (withLimit) params.set("limit", String(PRODUCT_PAGE_SIZE));
  return params.toString();
}

export type ModerationAction = "takedown" | "restore" | "delete" | "permanent-delete";

/** What an operator can do to a product in this state, by the same rules the seller backend enforces. */
export function availableModerationActions(product: ModerationProduct): ModerationAction[] {
  if (product.status === "trash") {
    return product.adminDeleted || product.takedownReason !== null ? ["restore", "permanent-delete"] : ["takedown", "permanent-delete"];
  }
  if (product.status === "takedown") return ["restore", "delete"];
  return ["takedown", "delete"];
}

export const MODERATION_COPY: Record<ModerationAction, { button: string; title: string; hint: string; confirm: string; done: string; needsReason: boolean; danger: boolean }> = {
  takedown: {
    button: "Take down",
    title: "Take this product down",
    hint: "It leaves the store at once. The seller sees your reason and cannot publish it until you restore it.",
    confirm: "Take down",
    done: "Product taken down",
    needsReason: true,
    danger: true,
  },
  restore: {
    button: "Restore",
    title: "Restore this product",
    hint: "It returns to the state it was in before. A product that was Live goes Live again at once.",
    confirm: "Restore",
    done: "Product restored",
    needsReason: false,
    danger: false,
  },
  delete: {
    button: "Delete",
    title: "Delete this product",
    hint: "It moves to trash and the seller cannot bring it back. You can restore it from here.",
    confirm: "Delete",
    done: "Product deleted",
    needsReason: true,
    danger: true,
  },
  "permanent-delete": {
    button: "Delete permanently",
    title: "Delete this product permanently",
    hint: "This cannot be undone. The product is gone for good and its reviews are archived.",
    confirm: "Delete permanently",
    done: "Product permanently deleted",
    needsReason: true,
    danger: true,
  },
};

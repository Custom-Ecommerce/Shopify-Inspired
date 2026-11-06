import { STORE_STATUS_VALUES, type StoreStatusValue } from "@/lib/status";

export const PAGE_SIZE = 20;

export interface StoreListState {
  page: number;
  q: string;
  status: StoreStatusValue | "";
}

export const DEFAULT_LIST_STATE: StoreListState = { page: 1, q: "", status: "" };

/** Anything unreadable falls back to the default, so a hand-edited URL never breaks the page. */
export function parseListState(params: { get(name: string): string | null }): StoreListState {
  const rawPage = params.get("page") ?? "";
  const page = /^\d{1,6}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const rawStatus = params.get("status") ?? "";
  const status = (STORE_STATUS_VALUES as readonly string[]).includes(rawStatus) ? (rawStatus as StoreStatusValue) : "";
  return { page, q, status };
}

/** The query string for a list state. Defaults are left out, so the first page of everything is the bare path. */
export function listStateToQuery(state: StoreListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.status !== "") params.set("status", state.status);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

export type GovernanceAction = "suspend" | "activate";

/** The same rules the backend enforces: suspend an active store; activate a suspended or pending one. */
export function availableActions(status: string): GovernanceAction[] {
  if (status === "active") return ["suspend"];
  if (status === "suspended" || status === "pending") return ["activate"];
  return [];
}

export const ACTION_COPY: Record<GovernanceAction, { button: string; confirm: string; title: string; hint: string; done: string; target: "active" | "suspended" }> = {
  suspend: {
    button: "Suspend store",
    confirm: "Confirm suspension",
    title: "Suspend this store",
    hint: "The seller is notified. Give the reason the seller will see in the history.",
    done: "Store suspended",
    target: "suspended",
  },
  activate: {
    button: "Activate store",
    confirm: "Confirm activation",
    title: "Activate this store",
    hint: "The store goes live and its suspension notes are cleared. The reason stays in the history.",
    done: "Store activated",
    target: "active",
  },
};

/** The mandatory reason, checked the same way the backend checks it. Returns a message, or null when it is fine. */
export function validateReason(reason: string, min: number, max: number): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < min) return "Enter a reason of at least " + min + " characters.";
  if (trimmed.length > max) return "The reason can be at most " + max + " characters.";
  return null;
}

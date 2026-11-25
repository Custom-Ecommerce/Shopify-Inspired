import { readPage, readSearch } from "@/lib/list-state";
import { shortId } from "@/lib/format";
import { PAGE_SIZE } from "@/lib/stores";

export interface AuditListState {
  page: number;
  q: string;
  action: string;
}

const ACTION_NAME = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export function parseAuditListState(params: { get(name: string): string | null }): AuditListState {
  const rawAction = (params.get("action") ?? "").trim();
  return { page: readPage(params), q: readSearch(params), action: ACTION_NAME.test(rawAction) ? rawAction : "" };
}

export function auditStateToQuery(state: AuditListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.action !== "") params.set("action", state.action);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

/** The link of the CSV export with the page's current filters (action and search). Dates are added by the export itself when asked for. */
export function auditExportHref(state: Pick<AuditListState, "q" | "action">, range: { from?: string; to?: string } = {}): string {
  const params = new URLSearchParams();
  if (state.q !== "") params.set("q", state.q);
  if (state.action !== "") params.set("action", state.action);
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString();
  return "/api/audit/export" + (query === "" ? "" : "?" + query);
}

const ACTION_LABELS: Record<string, string> = {
  "admin_user.invited": "Admin invited",
  "admin_user.level_changed": "Admin level changed",
  "admin_user.disabled": "Admin disabled",
  "admin_user.enabled": "Admin enabled",
  "audit.exported": "Audit log exported",
  "order.detail_viewed": "Order opened",
  "store.suspend": "Store suspended",
  "store.activate": "Store activated",
  "store.change_rolled_back": "Change not recorded",
};

/** A readable name for an action, or the action code itself when it has no label yet. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Who did it: the operator's name, or the id when the account is gone, or the raw actor such as "system". */
export function actorLabel(actor: { id: string; name: string | null }): string {
  if (actor.name !== null) return actor.name;
  if (OBJECT_ID.test(actor.id)) return "An operator (" + shortId(actor.id) + ")";
  return actor.id === "" ? "Unknown" : actor.id;
}

/** The console page for the target of an entry, when there is one. */
export function entityHref(entity: string, entityId: string): string | null {
  return entity === "store" && OBJECT_ID.test(entityId) ? "/stores/" + entityId : null;
}

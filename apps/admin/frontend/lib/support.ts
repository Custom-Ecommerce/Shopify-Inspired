/**
 * Sprint 7 (S7-B4): the admin console's support inbox (tickets and the platform's contact messages), as pure helpers and thin fetch calls. Every call goes
 * through this app's own /api routes, which forward to the admin backend (the capability is checked there). Messages are PLAIN TEXT from a seller or a visitor:
 * the screens render them as React text children, never as markup.
 */

export const TICKET_STATUSES = ["open", "answered", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const CONTACT_STATUSES = ["new", "read", "replied", "closed"] as const;
export const SUPPORT_TEXT_MAX = 3000;
export const SUPPORT_PAGE_SIZE = 20;

export const TICKET_STATUS_LABELS: Record<string, string> = { open: "Open", answered: "Answered", closed: "Closed" };
export const CONTACT_STATUS_LABELS: Record<string, string> = { new: "New", read: "Read", replied: "Replied", closed: "Closed" };

export interface TicketRow {
  id: string;
  subject: string;
  status: string;
  revision: number;
  messageCount: number;
  lastMessageAt: string | null;
  lastFrom: string | null;
  orderRef: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
}

export interface TicketMessage {
  from: string;
  text: string;
  at: string | null;
  byId: string;
}

export interface TicketDetail extends TicketRow {
  messages: TicketMessage[];
}

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  revision: number;
  createdAt: string | null;
  replies: Array<{ text: string; at: string | null; by: string; channel: string }>;
}

export interface SupportList<T> {
  docs: T[];
  page: number;
  totalDocs: number;
  totalPages: number;
}

export interface SupportListState {
  status: string;
  page: number;
}

/** A hand-edited URL never breaks the page: anything unreadable falls back to the default. */
export function parseSupportState(params: { get(name: string): string | null }, statuses: readonly string[]): SupportListState {
  const raw = params.get("page") ?? "";
  const status = statuses.find((value) => value === params.get("status")) ?? "";
  return { status, page: /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1 };
}

export function supportStateToQuery(state: SupportListState): string {
  const params = new URLSearchParams();
  if (state.status !== "") params.set("status", state.status);
  if (state.page > 1) params.set("page", String(state.page));
  params.set("limit", String(SUPPORT_PAGE_SIZE));
  return params.toString();
}

/** Why a reply cannot be sent yet (empty, too long), or null. */
export function replyProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "Write a reply.";
  if (trimmed.length > SUPPORT_TEXT_MAX) return "The reply can be at most 3000 characters.";
  return null;
}

export interface SupportFailure {
  message: string;
  status: number;
  code?: string;
  revisionConflict: boolean;
  closed: boolean;
}

/** Reads the proxy's refusal ({ error, code }) into what the screen shows. */
export function readSupportFailure(status: number, body: unknown, fallback = "That did not work. Try again."): SupportFailure {
  const rec = (body ?? {}) as { error?: unknown; code?: unknown };
  const code = typeof rec.code === "string" ? rec.code : undefined;
  return {
    message: typeof rec.error === "string" ? rec.error : fallback,
    status,
    ...(code === undefined ? {} : { code }),
    revisionConflict: code === "TICKET_REVISION_CONFLICT",
    closed: code === "TICKET_CLOSED",
  };
}

export type SupportResult<T> = { ok: true; value: T } | { ok: false; failure: SupportFailure };

async function call<T>(url: string, init: RequestInit | undefined, pick: (body: Record<string, unknown>) => T | null): Promise<SupportResult<T>> {
  try {
    const res = await fetch(url, { ...init, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ok: false, failure: readSupportFailure(res.status, body) };
    const value = body === null ? null : pick(body);
    return value === null ? { ok: false, failure: readSupportFailure(502, null, "Unexpected answer from the server.") } : { ok: true, value };
  } catch {
    return { ok: false, failure: readSupportFailure(0, null, "Could not reach the server. Try again.") };
  }
}

const asList = <T,>(body: Record<string, unknown>): SupportList<T> | null =>
  Array.isArray(body.docs) ? { docs: body.docs as T[], page: Number(body.page ?? 1), totalDocs: Number(body.totalDocs ?? 0), totalPages: Number(body.totalPages ?? 1) } : null;

const jsonInit = (method: string, payload: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

export const fetchTickets = (state: SupportListState) => call<SupportList<TicketRow>>("/api/tickets?" + supportStateToQuery(state), undefined, (b) => asList<TicketRow>(b));
export const fetchTicket = (id: string) => call<TicketDetail>("/api/tickets/" + encodeURIComponent(id), undefined, (b) => (b.ticket ? (b.ticket as TicketDetail) : null));
export const replyToTicket = (id: string, revision: number, text: string) =>
  call<TicketDetail>("/api/tickets/" + encodeURIComponent(id) + "/reply", jsonInit("POST", { revision, text: text.trim() }), (b) => (b.ticket ? (b.ticket as TicketDetail) : null));
export const changeTicketStatus = (id: string, revision: number, status: TicketStatus) =>
  call<TicketDetail>("/api/tickets/" + encodeURIComponent(id) + "/status", jsonInit("POST", { revision, status }), (b) => (b.ticket ? (b.ticket as TicketDetail) : null));
export const fetchContactMessages = (state: SupportListState) => call<SupportList<ContactRow>>("/api/contact-messages?" + supportStateToQuery(state), undefined, (b) => asList<ContactRow>(b));
export const fetchContactMessage = (id: string) => call<ContactRow>("/api/contact-messages/" + encodeURIComponent(id), undefined, (b) => (b.message ? (b.message as ContactRow) : null));

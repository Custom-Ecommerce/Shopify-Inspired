/**
 * Sprint 7 (S7-B4): the seller's contact inbox and support tickets on the dashboard side, as pure helpers and thin calls through the same-origin BFF. The limits
 * mirror packages/contracts/src/support.ts (the test compares them). Everything a shopper or an admin wrote is PLAIN TEXT: the screens show it as React text
 * children, never as markup.
 */

export const SUPPORT_LIMITS = { subject: { min: 3, max: 150 }, message: { min: 5, max: 3000 }, reply: { min: 1, max: 3000 }, orderRef: 40 } as const;
export const SUPPORT_PAGE_SIZE = 20;

export const CONTACT_STATUS_LIST = ["new", "read", "replied", "closed"] as const;
export const TICKET_STATUS_LIST = ["open", "answered", "closed"] as const;
export const CONTACT_STATUS_LABELS: Record<string, string> = { new: "New", read: "Read", replied: "Replied", closed: "Closed" };
export const TICKET_STATUS_LABELS: Record<string, string> = { open: "Open", answered: "Answered by support", closed: "Closed" };

export function contactStatusLabel(status: string): string {
  return CONTACT_STATUS_LABELS[status] ?? status;
}
export function ticketStatusLabel(status: string): string {
  return TICKET_STATUS_LABELS[status] ?? status;
}

export interface ContactReply {
  text: string;
  at: string | null;
  by: string;
  channel: string;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  revision: number;
  replies: ContactReply[];
  waLink: string | null;
  createdAt: string | null;
}

export interface TicketMessage {
  from: string;
  text: string;
  at: string | null;
  byId: string;
}

export interface TicketItem {
  id: string;
  subject: string;
  status: string;
  revision: number;
  orderRef: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  lastFrom: string | null;
  messages?: TicketMessage[];
}

export interface SupportList<T> {
  docs: T[];
  page: number;
  totalDocs: number;
  totalPages: number;
}

/** Reads the list envelope. Null when the answer is not what the screen expects. */
export function readList<T>(body: unknown, accept: (row: unknown) => row is T): SupportList<T> | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as { docs?: unknown; page?: unknown; totalDocs?: unknown; totalPages?: unknown };
  if (!Array.isArray(rec.docs)) return null;
  return {
    docs: rec.docs.filter(accept),
    page: typeof rec.page === "number" ? rec.page : 1,
    totalDocs: typeof rec.totalDocs === "number" ? rec.totalDocs : rec.docs.length,
    totalPages: typeof rec.totalPages === "number" ? rec.totalPages : 1,
  };
}

const isRow = (row: unknown): row is { id: string } => typeof row === "object" && row !== null && typeof (row as { id?: unknown }).id === "string";
export const isContactMessage = (row: unknown): row is ContactMessage => isRow(row) && typeof (row as { message?: unknown }).message === "string";
export const isTicket = (row: unknown): row is TicketItem => isRow(row) && typeof (row as { subject?: unknown }).subject === "string";

/** The number the navigation shows beside Inbox: the unread (status new) total, "" for none, "99+" for a lot. */
export function unreadBadge(count: number | null): string {
  if (count === null || !Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** The query of a list call: only a known status and a page above 1. */
export function supportQuery(statuses: readonly string[], status: string, page: number, limit = SUPPORT_PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (statuses.includes(status)) params.set("status", status);
  if (Number.isInteger(page) && page > 1) params.set("page", String(page));
  params.set("limit", String(limit));
  return params.toString();
}

/** The WhatsApp link only when it is a wa.me address (the backend builds it; the screen never trusts any other host). */
export function safeWaLink(link: unknown): string | null {
  return typeof link === "string" && /^https:\/\/wa\.me\/\d{10,15}(\?text=[^\s]*)?$/.test(link) ? link : null;
}

// --------------------------------------------------------------------------------------------------------------------------------- forms

export interface TicketFormValues {
  subject: string;
  message: string;
  orderRef: string;
}

export function emptyTicketForm(): TicketFormValues {
  return { subject: "", message: "", orderRef: "" };
}

/** Problems the form can see before it sends anything, by the field names the backend uses. */
export function ticketFormProblems(values: TicketFormValues): Record<string, string> {
  const problems: Record<string, string> = {};
  const subject = values.subject.trim();
  if (subject.length < SUPPORT_LIMITS.subject.min) problems.subject = "The subject needs at least 3 characters.";
  else if (subject.length > SUPPORT_LIMITS.subject.max) problems.subject = "The subject can be at most 150 characters.";
  const message = values.message.trim();
  if (message.length < SUPPORT_LIMITS.message.min) problems.message = "Describe the problem in at least 5 characters.";
  else if (message.length > SUPPORT_LIMITS.message.max) problems.message = "The message can be at most 3000 characters.";
  if (values.orderRef.trim().length > SUPPORT_LIMITS.orderRef) problems.orderRef = "The order number can be at most 40 characters.";
  return problems;
}

/** The body of a new ticket: trimmed, and the order number only when there is one. Never a store or a status. */
export function ticketFormToPayload(values: TicketFormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = { subject: values.subject.trim(), message: values.message.trim() };
  if (values.orderRef.trim() !== "") payload.orderRef = values.orderRef.trim();
  return payload;
}

/** Why a reply cannot be sent yet, or null. */
export function replyProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < SUPPORT_LIMITS.reply.min) return "Write a reply.";
  if (trimmed.length > SUPPORT_LIMITS.reply.max) return "The reply can be at most 3000 characters.";
  return null;
}

// ----------------------------------------------------------------------------------------------------------------------------- failures

export interface SupportFailure {
  message: string;
  field?: string;
  revisionConflict: boolean;
  closed: boolean;
}

/** Reads a refused call (the BFF's `{ error, code, field }`) into what the screen shows. */
export function readSupportFailure(status: number, body: unknown, fallback = "That did not work. Please try again."): SupportFailure {
  const rec = (body ?? {}) as { error?: unknown; code?: unknown; field?: unknown; details?: unknown };
  const first = Array.isArray(rec.details) ? (rec.details[0] as { message?: unknown } | undefined) : undefined;
  const message = typeof rec.error === "string" ? rec.error : typeof first?.message === "string" ? first.message : fallback;
  const field = typeof rec.field === "string" ? rec.field : undefined;
  return {
    message,
    ...(field === undefined ? {} : { field }),
    revisionConflict: rec.code === "TICKET_REVISION_CONFLICT" || rec.code === "CONTACT_REVISION_CONFLICT" || (status === 409 && field === "revision"),
    closed: rec.code === "TICKET_CLOSED" || rec.code === "CONTACT_CLOSED",
  };
}

type StoreFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type SupportResult<T> = { ok: true; value: T } | { ok: false; failure: SupportFailure; status: number };

const NETWORK: SupportFailure = { message: "Could not reach the backend. Please try again.", revisionConflict: false, closed: false };

async function call<T>(storeFetch: StoreFetch, url: string, init: RequestInit | undefined, pick: (body: unknown) => T | null, fallback: string): Promise<SupportResult<T>> {
  try {
    const res = await storeFetch(url, { cache: "no-store", ...init });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, failure: readSupportFailure(res.status, body, fallback), status: res.status };
    const value = pick(body);
    return value === null ? { ok: false, failure: { message: fallback, revisionConflict: false, closed: false }, status: res.status } : { ok: true, value };
  } catch {
    return { ok: false, failure: NETWORK, status: 0 };
  }
}

const json = (method: string, payload: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const ticketOf = (body: unknown): TicketItem | null => (isTicket(body) ? body : null);
const contactOf = (body: unknown): ContactMessage | null => (isContactMessage(body) ? body : null);

export const fetchContactMessages = (storeFetch: StoreFetch, status: string, page: number) =>
  call(storeFetch, "/api/dashboard/contactMessages?" + supportQuery(CONTACT_STATUS_LIST, status, page), undefined, (b) => readList(b, isContactMessage), "Could not load your inbox.");

export const fetchContactMessage = (storeFetch: StoreFetch, id: string) => call(storeFetch, "/api/dashboard/contactMessages/" + encodeURIComponent(id), undefined, contactOf, "Could not load this message.");

/** The unread total for the navigation (status new, one row). Null when it cannot be read: the badge then shows nothing. */
export async function fetchUnreadCount(storeFetch: StoreFetch): Promise<number | null> {
  const result = await call(storeFetch, "/api/dashboard/contactMessages?status=new&limit=1", undefined, (b) => readList(b, isContactMessage), "");
  return result.ok ? result.value.totalDocs : null;
}

export const markContactRead = (storeFetch: StoreFetch, id: string, revision: number) =>
  call(storeFetch, "/api/dashboard/contactMessages/" + encodeURIComponent(id), json("PATCH", { revision, status: "read" }), contactOf, "Could not mark this message as read.");

export const closeContactMessage = (storeFetch: StoreFetch, id: string, revision: number) =>
  call(storeFetch, "/api/dashboard/contactMessages/" + encodeURIComponent(id), json("PATCH", { revision, status: "closed" }), contactOf, "Could not close this message.");

export interface ContactReplyAnswer {
  message: ContactMessage;
  channel: string;
  whatsappLink: string | null;
}

export const replyToContact = (storeFetch: StoreFetch, id: string, revision: number, text: string) =>
  call<ContactReplyAnswer>(
    storeFetch,
    "/api/dashboard/contactMessages/" + encodeURIComponent(id) + "/reply",
    json("POST", { revision, text: text.trim() }),
    (b) => {
      const rec = (b ?? {}) as { message?: unknown; channel?: unknown; whatsappLink?: unknown };
      return isContactMessage(rec.message) ? { message: rec.message, channel: typeof rec.channel === "string" ? rec.channel : "email", whatsappLink: safeWaLink(rec.whatsappLink) } : null;
    },
    "Could not send your reply.",
  );

export const fetchTickets = (storeFetch: StoreFetch, status: string, page: number) =>
  call(storeFetch, "/api/dashboard/tickets?" + supportQuery(TICKET_STATUS_LIST, status, page), undefined, (b) => readList(b, isTicket), "Could not load your tickets.");

export const fetchTicket = (storeFetch: StoreFetch, id: string) => call(storeFetch, "/api/dashboard/tickets/" + encodeURIComponent(id), undefined, ticketOf, "Could not load this ticket.");

export const createTicket = (storeFetch: StoreFetch, values: TicketFormValues) => call(storeFetch, "/api/dashboard/tickets", json("POST", ticketFormToPayload(values)), ticketOf, "Could not send your ticket.");

export const replyToTicket = (storeFetch: StoreFetch, id: string, revision: number, text: string) =>
  call(storeFetch, "/api/dashboard/tickets/" + encodeURIComponent(id) + "/reply", json("POST", { revision, text: text.trim() }), ticketOf, "Could not send your reply.");

export const closeTicket = (storeFetch: StoreFetch, id: string, revision: number) =>
  call(storeFetch, "/api/dashboard/tickets/" + encodeURIComponent(id) + "/close", json("POST", { revision }), ticketOf, "Could not close this ticket.");

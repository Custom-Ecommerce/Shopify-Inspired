/**
 * Sprint 7 (S7-B4): the PLATFORM contact form (the marketing site, not a store). The storefront app's /api/contact route reads the form, builds the body for the
 * seller backend's public route, and turns the backend's answer into its own. Both steps are here, pure, so a check file can test them (the storefront has no unit
 * test runner). The one rule the old route broke: success is answered ONLY when the seller backend says it stored the message. Any other outcome is an error.
 */

export const PLATFORM_CONTACT_SCOPE = "platform";

export interface PlatformContactBody {
  name: string;
  email: string;
  message: string;
  consent: true;
  website?: string;
}

export type PlatformContactBuild = { ok: true; body: PlatformContactBody } | { ok: false; field: string; message: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * The form posts { name, email, topic, message, consent, "bot-field" }. The topic is part of the message (the platform reads one text), the honeypot becomes
 * `website`, and a missing consent is a refusal here, so the visitor sees which box to tick. The backend checks everything again.
 */
export function buildPlatformContactBody(raw: unknown): PlatformContactBuild {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, field: "body", message: "The form could not be read." };
  const form = raw as Record<string, unknown>;
  const name = text(form.name);
  const email = text(form.email);
  const message = text(form.message);
  const topic = text(form.topic);
  if (name === "") return { ok: false, field: "name", message: "Enter your name." };
  if (email === "") return { ok: false, field: "email", message: "Enter your email address." };
  if (message === "") return { ok: false, field: "message", message: "Write a message." };
  if (!(form.consent === true || form.consent === "on" || form.consent === "true")) return { ok: false, field: "consent", message: "Please agree to be contacted." };
  const full = topic === "" ? message : "Topic: " + topic.slice(0, 60) + "\n\n" + message;
  const honeypot = text(form["bot-field"]);
  return { ok: true, body: { name, email, message: full, consent: true, ...(honeypot === "" ? {} : { website: honeypot }) } };
}

export interface PlatformContactAnswer {
  status: number;
  body: { success: true; message: string } | { error: string; field?: string };
  /** Seconds to wait, for a 429. */
  retryAfter?: number;
}

/**
 * The route's answer for the seller backend's answer. 2xx with { data: { received: true } } is the ONLY success: a 2xx with any other body, a gateway error, a
 * timeout (status 0) and every unknown status are errors, so the visitor is never told "received" about a message nobody kept.
 */
export function platformContactAnswer(status: number, payload: unknown, retryAfterHeader?: string | null): PlatformContactAnswer {
  const rec = (typeof payload === "object" && payload !== null ? payload : {}) as { data?: { received?: unknown }; error?: { message?: unknown }; field?: unknown; retryAfterSeconds?: unknown };
  if (status >= 200 && status <= 299 && rec.data?.received === true) return { status: 200, body: { success: true, message: "Message received" } };
  const field = typeof rec.field === "string" ? rec.field : undefined;
  if (status === 400) return { status: 400, body: { error: typeof rec.error?.message === "string" ? rec.error.message : "Please check the form and try again.", ...(field === undefined ? {} : { field }) } };
  if (status === 429) {
    const header = retryAfterHeader === undefined || retryAfterHeader === null ? Number.NaN : Number.parseInt(retryAfterHeader, 10);
    const body = typeof rec.retryAfterSeconds === "number" ? rec.retryAfterSeconds : header;
    return { status: 429, body: { error: "You have sent several messages already. Please wait a few minutes and try again." }, ...(Number.isFinite(body) ? { retryAfter: Math.max(1, Math.ceil(body)) } : {}) };
  }
  return { status: 503, body: { error: "We could not send your message. Please try again in a moment." } };
}

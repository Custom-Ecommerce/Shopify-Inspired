import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { HttpError } from '@/lib/http';
import { plainDoc, toWire } from '@/lib/seller-scope';

/**
 * Sprint 7 (S7-B4): what the contact inbox and the ticket routes share. Helpers live here, never in a route file.
 */

/** The JSON body of a write, checked against a strict contract. A 400 carries the contract's code and names the field. */
export async function parseSupportBody<T>(request: NextRequest, schema: ZodType<T, unknown>, code: string): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, 'Body must be JSON', code, 'body');
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (issue?.code === 'unrecognized_keys') {
    const key = String(issue.keys[0] ?? 'body');
    throw new HttpError(400, 'The field ' + key + ' cannot be set here.', code, key);
  }
  throw new HttpError(400, issue?.message ?? 'The request is not valid.', code, String(issue?.path[0] ?? 'body'));
}

/** Page and limit from a query: whole numbers, clamped. */
export function pageOf(params: URLSearchParams, defaultLimit = 20, maxLimit = 50): { page: number; limit: number } {
  const num = (raw: string | null, fallback: number, min: number, max: number): number => {
    const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return { page: num(params.get('page'), 1, 1, 10000), limit: num(params.get('limit'), defaultLimit, 1, maxLimit) };
}

/**
 * A wa.me link for a Pakistani mobile number (digits only; 03xx becomes 923xx), with an optional prefilled text, or null when the number is not usable.
 * Used when the shopper gave a phone and no email: the seller answers from their own WhatsApp.
 */
export function whatsappLink(phone: unknown, text?: string): string | null {
  if (typeof phone !== 'string') return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  if (digits.length < 10 || digits.length > 15) return null;
  return 'https://wa.me/' + digits + (text ? '?text=' + encodeURIComponent(text.slice(0, 1000)) : '');
}

const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

export interface ContactReplyWire {
  text: string;
  at: string | null;
  by: string;
  channel: string;
}

/** A contact message as the inbox reads it. Text fields are plain text: the dashboard shows them as text, never as markup. */
export function contactToWire(doc: unknown): Record<string, unknown> {
  const wire = toWire(plainDoc(doc));
  const replies = Array.isArray(wire.replies) ? (wire.replies as Array<Record<string, unknown>>) : [];
  const email = typeof wire.email === 'string' ? wire.email : '';
  const phone = typeof wire.phone === 'string' && wire.phone !== '' ? wire.phone : null;
  return {
    id: wire.id,
    scope: wire.scope,
    name: wire.name,
    email,
    phone,
    message: typeof wire.message === 'string' ? wire.message : '',
    status: wire.status,
    consent: wire.consent === true,
    replies: replies.map((r): ContactReplyWire => ({ text: String(r.text ?? ''), at: iso(r.at), by: String(r.by ?? ''), channel: String(r.channel ?? '') })),
    revision: typeof wire.revision === 'number' ? wire.revision : 0,
    // No email: the seller answers on WhatsApp; this opens the chat.
    waLink: email === '' ? whatsappLink(phone) : null,
    createdAt: iso(wire.createdAt),
    updatedAt: iso(wire.updatedAt),
  };
}

export interface TicketMessageWire {
  from: string;
  text: string;
  at: string | null;
  byId: string;
}

/** A ticket as the seller and the admin read it. withMessages false is the list form: the count and the last message time only. */
export function ticketToWire(doc: unknown, options: { withMessages?: boolean } = {}): Record<string, unknown> {
  const wire = toWire(plainDoc(doc));
  const messages = Array.isArray(wire.messages) ? (wire.messages as Array<Record<string, unknown>>) : [];
  const mapped = messages.map((m): TicketMessageWire => ({ from: String(m.from ?? ''), text: String(m.text ?? ''), at: iso(m.at), byId: String(m.byId ?? '') }));
  const out: Record<string, unknown> = {
    id: wire.id,
    seller: wire.seller === undefined ? null : String(wire.seller),
    store: wire.store === undefined || wire.store === null ? null : String(wire.store),
    subject: wire.subject,
    status: wire.status,
    orderRef: typeof wire.orderRef === 'string' && wire.orderRef !== '' ? wire.orderRef : null,
    revision: typeof wire.revision === 'number' ? wire.revision : 0,
    messageCount: mapped.length,
    lastMessageAt: mapped.length > 0 ? mapped[mapped.length - 1]!.at : iso(wire.createdAt),
    lastFrom: mapped.length > 0 ? mapped[mapped.length - 1]!.from : null,
    createdAt: iso(wire.createdAt),
    updatedAt: iso(wire.updatedAt),
  };
  if (options.withMessages !== false) out.messages = mapped;
  return out;
}

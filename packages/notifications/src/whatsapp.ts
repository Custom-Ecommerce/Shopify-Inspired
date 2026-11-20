import { normalizePhoneE164 } from '@markaz/contracts/checkout';
import { MESSAGE_VARIABLES, type MessageVariable } from '@markaz/contracts/store-settings';
import { renderTemplate, type TemplateName, type TemplateVars } from './templates';

/**
 * WhatsApp without an API (D-091): a wa.me link with a prefilled text that a person opens and sends by hand. No cost,
 * nothing queued. Browser-safe (no Node API), so the seller dashboard and the storefront can build the same link.
 *
 * packages/core/src/whatsapp.ts builds the older checkout "new COD order" text for a business number; it is kept as it is
 * (the storefront shell uses it) and this module is the one for Sprint 4 messages.
 */

/** The number in the form wa.me wants (digits only, country code first), from the shared Pakistani phone rule. */
export function whatsappDigits(phone: unknown): string | null {
  const e164 = normalizePhoneE164(phone);
  return e164 === null ? null : e164.slice(1);
}

/** A wa.me link to that number with the text filled in, or null when the number is not a Pakistani mobile number. */
export function whatsappLink(phone: unknown, text: string): string | null {
  const digits = whatsappDigits(phone);
  if (digits === null) return null;
  const message = text.trim();
  return 'https://wa.me/' + digits + (message === '' ? '' : '?text=' + encodeURIComponent(message));
}

/** The WhatsApp text of a template, or null when a value it needs is missing. */
export function whatsappTemplateText(name: TemplateName, vars: TemplateVars): string | null {
  try {
    return renderTemplate(name, vars).whatsapp;
  } catch {
    return null;
  }
}

const OVERRIDE_PLACEHOLDER = /\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}/g;

/**
 * The seller's own WhatsApp text (EP-07.US02.T02) with its {names} filled in. A name that is not one of MESSAGE_VARIABLES is
 * left as written (the settings save refuses such a text, so this only guards an old value).
 */
export function renderMessageOverride(template: string, values: Partial<Record<MessageVariable, string>>): string {
  return template.replace(OVERRIDE_PLACEHOLDER, (whole, name: string) =>
    (MESSAGE_VARIABLES as readonly string[]).includes(name) ? (values[name as MessageVariable] ?? '') : whole,
  );
}

/** What the settings screen previews: the seller's text, or the platform's "confirmed" text when there is none, with sample values. */
export function whatsappPreviewText(override: string | null | undefined, storeName: string): string {
  const values = {
    storeName: storeName.trim() || 'our store',
    customerName: 'Ayesha',
    orderNumber: 'ORD-ABCD2345',
    courier: 'TCS',
    trackingNumber: 'TCS-1001',
    trackingLink: 'https://yourstore.markazify.com/track?order=ORD-ABCD2345',
  };
  const custom = override?.trim();
  if (custom) return renderMessageOverride(custom, values);
  return whatsappTemplateText('order_confirmed', values) ?? '';
}

/** Which order statuses the seller may message the customer about from the order page (EP-07.US01.T05). */
export const SELLER_WHATSAPP_STATUSES = ['confirmed', 'dispatched', 'delivered'] as const;

const STATUS_TEMPLATE: Record<(typeof SELLER_WHATSAPP_STATUSES)[number], TemplateName> = {
  confirmed: 'order_confirmed',
  dispatched: 'order_dispatched',
  delivered: 'order_delivered',
};

export interface SellerWhatsappOrder {
  status: string;
  orderNumber: string;
  customerName: string | null;
  phone: string | null;
  /** The customer's WhatsApp number when it differs from the phone. */
  customerWhatsapp: string | null;
  courier: string | null;
  trackingNumber: string | null;
  /** Where the customer can track the order; a short fallback text is used when there is none. */
  trackingLink?: string | null;
}

/**
 * The seller's "Message customer on WhatsApp" link for an order: only for confirmed, dispatched (with courier and tracking
 * number) and delivered orders, to the customer's WhatsApp number or else their phone. Null when it does not apply.
 */
export function sellerToCustomerWhatsappLink(order: SellerWhatsappOrder, storeName: string, override?: string | null): string | null {
  const status = order.status as (typeof SELLER_WHATSAPP_STATUSES)[number];
  const template = STATUS_TEMPLATE[status];
  if (!template) return null;
  if (status === 'dispatched' && (!order.courier || !order.trackingNumber)) return null;
  const values = {
    storeName: storeName.trim() || 'our store',
    customerName: order.customerName?.trim() || 'there',
    orderNumber: order.orderNumber,
    courier: order.courier ?? '',
    trackingNumber: order.trackingNumber ?? '',
    trackingLink: order.trackingLink?.trim() || 'ask us for the tracking page',
  };
  // The seller's own text (EP-07.US02.T02) replaces the platform's text for every status the link applies to.
  const custom = override?.trim() ? renderMessageOverride(override.trim(), values).trim() : '';
  const text = custom !== '' ? custom : whatsappTemplateText(template, values);
  if (text === null) return null;
  return whatsappLink(order.customerWhatsapp || order.phone, text);
}

/** The shopper's "Message the seller on WhatsApp" link on the order confirmation page, or null without a store number. */
export function customerToSellerWhatsappLink(storeWhatsapp: string | null | undefined, storeName: string, orderNumber: string): string | null {
  if (!storeWhatsapp) return null;
  const name = storeName.trim() || 'there';
  const text = 'Hi ' + name + ', I have a question about my order ' + orderNumber + '.\nالسلام علیکم، میرے آرڈر ' + orderNumber + ' کے بارے میں سوال ہے۔';
  return whatsappLink(storeWhatsapp, text);
}

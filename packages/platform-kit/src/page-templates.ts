/**
 * Sprint 7 (S7-B3, D-118): the editable templates of a store's default pages, and the rule for a placeholder that must be edited.
 *
 * A seller's pages manager lists these five templates. Nothing is created until the seller asks for one ("create from template"), and the text is then
 * the seller's own to edit. The legal pages (privacy, returns) cannot be written for a store by the platform: they carry visible `[[EDIT: ...]]`
 * placeholders. The dashboard warns while one is still in the text and asks for confirmation before it publishes such a page.
 *
 * Pure: no I/O. Used by the seller backend (create from template), the seller dashboard (the warning) and the tests.
 */

/** Matches one placeholder, for example `[[EDIT: your business name]]`. */
export const PLACEHOLDER_PATTERN = /\[\[\s*EDIT\s*:[^\]]*\]\]/i;

/** Whether a text still holds a placeholder the seller must edit. */
export function hasPlaceholder(text: unknown): boolean {
  return typeof text === "string" && PLACEHOLDER_PATTERN.test(text);
}

/** How many placeholders a text holds (for the warning). */
export function countPlaceholders(text: unknown): number {
  return typeof text === "string" ? (text.match(new RegExp(PLACEHOLDER_PATTERN.source, "gi")) ?? []).length : 0;
}

export const PAGE_TEMPLATE_KEYS = ["about", "contact", "shipping", "returns", "privacy"] as const;
export type PageTemplateKey = (typeof PAGE_TEMPLATE_KEYS)[number];

export interface PageTemplate {
  key: PageTemplateKey;
  /** The page's title and web address (/pages/<slug>). */
  title: string;
  slug: PageTemplateKey;
  body: string;
  /** Whether the footer links to the page once it is published. */
  showInFooter: boolean;
  /** True for a page whose text the platform cannot write for the store. */
  legal: boolean;
}

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    key: "about",
    slug: "about",
    title: "About us",
    showInFooter: true,
    legal: false,
    body: [
      "# About us",
      "",
      "Tell shoppers who you are. [[EDIT: write two or three sentences about your store, what you sell and why.]]",
      "",
      "## What we offer",
      "",
      "- [[EDIT: your main product or category]]",
      "- Cash on delivery across Pakistan",
      "- Easy order tracking from the track order page",
    ].join("\n"),
  },
  {
    key: "contact",
    slug: "contact",
    title: "Contact us",
    showInFooter: true,
    legal: false,
    body: [
      "# Contact us",
      "",
      "Questions about an order or a product? We are happy to help.",
      "",
      "- WhatsApp: [[EDIT: your WhatsApp number]]",
      "- Email: [[EDIT: your email address]]",
      "- Hours: [[EDIT: for example Monday to Saturday, 10am to 7pm]]",
      "",
      "You can check an order at any time from the track order page.",
    ].join("\n"),
  },
  {
    key: "shipping",
    slug: "shipping",
    title: "Shipping and delivery",
    showInFooter: true,
    legal: false,
    body: [
      "# Shipping and delivery",
      "",
      "## Delivery time",
      "",
      "Orders are usually delivered in [[EDIT: number of days]] working days. Remote areas may take longer.",
      "",
      "## Delivery charges",
      "",
      "[[EDIT: your delivery charge, and the order amount above which delivery is free]]",
      "",
      "## Payment",
      "",
      "Pay cash on delivery when your parcel arrives.",
    ].join("\n"),
  },
  {
    key: "returns",
    slug: "returns",
    title: "Returns and exchanges",
    showInFooter: true,
    legal: true,
    body: [
      "# Returns and exchanges",
      "",
      "[[EDIT: This is a template, not legal advice. Write your own return policy: how many days shoppers have, what condition the item must be in, who pays for the return, and how a refund or an exchange is made. Remove this note before you publish.]]",
      "",
      "## How to ask for a return",
      "",
      "Use the track order page, then choose the return option on your delivered order.",
    ].join("\n"),
  },
  {
    key: "privacy",
    slug: "privacy",
    title: "Privacy policy",
    showInFooter: true,
    legal: true,
    body: [
      "# Privacy policy",
      "",
      "[[EDIT: This is a template, not legal advice. Write your own privacy policy for your business: what you collect (name, phone, address, email for orders), why, who sees it, how long you keep it, and how a shopper can ask you to delete it. Remove this note before you publish.]]",
      "",
      "## Contact about your data",
      "",
      "[[EDIT: the email address or number where shoppers can reach you about their data]]",
    ].join("\n"),
  },
];

export function getPageTemplate(key: unknown): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((template) => template.key === key);
}

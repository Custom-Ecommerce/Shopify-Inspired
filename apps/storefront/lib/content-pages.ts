/**
 * DEFAULT copy for /pages/<slug> (Sprint 7, S7-B3). A store's own PUBLISHED page at that address always wins; this copy is shown only when the store has
 * no page there at all (not even a draft: a draft is a 404). Plain text. Sellers write their own in the dashboard (Pages), starting from the editable
 * templates in packages/platform-kit/src/page-templates.ts.
 */
export const CONTENT_PAGES: Record<string, { title: string; body: string }> = {
  about: {
    title: "About us",
    body: "We are an online store. Browse our collections, pay cash on delivery, and track your order at any time from the track order page.",
  },
  contact: {
    title: "Contact",
    body: "Questions about an order? Use the track order page to check its status, or message the store on WhatsApp.",
  },
};

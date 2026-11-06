/**
 * Public store paths, as a shopper sees them on the store's own host. The middleware rewrites
 * these onto the internal demo or tenant tree, so themes never see the rewritten prefix and
 * never build URL strings themselves.
 */
export const storePaths = {
  catalog: "/products",
  cart: "/cart",
  checkout: "/checkout",
  /** The search page. The search form submits here, with the query in the q parameter. */
  search: "/search",
  /** The search page for one query. */
  searchFor: (query: string) => "/search?q=" + encodeURIComponent(query),
  /** Order tracking. Pass an order reference to prefill the form. */
  track: (orderId?: string) => (orderId ? "/track?order=" + encodeURIComponent(orderId) : "/track"),
  product: (slug: string) => "/products/" + encodeURIComponent(slug),
  order: (orderId: string) => "/orders/" + encodeURIComponent(orderId),
  /** Category pages, for themes that provide them. */
  collections: "/collections",
  collection: (slug: string) => "/collections/" + encodeURIComponent(slug),
  /** The review form, for themes that provide it. */
  feedback: (productSlug?: string, orderId?: string) => {
    const params = new URLSearchParams();
    if (productSlug) params.set("product", productSlug);
    if (orderId) params.set("order", orderId);
    const qs = params.toString();
    return "/feedback" + (qs ? "?" + qs : "");
  },
  /** Static content pages (about, contact). */
  page: (slug: string) => "/pages/" + encodeURIComponent(slug),
};
/* @theme-integration-patch:paths */

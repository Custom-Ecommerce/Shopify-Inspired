import { storePaths } from "@markaz/storefront-data";

/** The only place in the theme that writes a root-relative URL. Everything else asks this helper. */
export const paths = {
  home: "/",
  catalog: storePaths.catalog,
  cart: storePaths.cart,
  checkout: storePaths.checkout,
  search: storePaths.search,
  searchFor: storePaths.searchFor,
  track: storePaths.track,
  product: storePaths.product,
  order: storePaths.order,
  collections: storePaths.collections,
  collection: storePaths.collection,
  feedback: storePaths.feedback,
  page: storePaths.page,
} as const;

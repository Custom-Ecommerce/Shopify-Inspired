import { TransportUnavailableError } from "../transport/errors";
import type { TransportUnavailableReason } from "../transport/errors";
import type { StorefrontTransport } from "../transport/types";
import { toCategoryVMs } from "../view-models/chrome";
import type { HomePageProps } from "../view-models/pages";
import { toProductCardVM } from "../view-models/product-card";
import { loadAllProducts } from "./all-products";

export type HomePageData =
  | { status: "ok"; data: HomePageProps }
  | { status: "unavailable"; reason: TransportUnavailableReason };

const FEATURED_COUNT = 8;

/**
 * Home page data. The backend exposes no featured flag, so "featured" is the best-rated products; ties keep the
 * backend's order (newest first). Categories and the whole list are included for themes that group by category.
 */
export async function loadHomePage(transport: StorefrontTransport): Promise<HomePageData> {
  try {
    const [categories, products] = await Promise.all([transport.listCategories(), loadAllProducts(transport)]);
    const cards = products.map((p) => toProductCardVM(p));
    const featured = cards
      .map((card, index) => ({ card, index }))
      .sort((a, b) => (b.card.rating?.average ?? 0) - (a.card.rating?.average ?? 0) || a.index - b.index)
      .slice(0, FEATURED_COUNT)
      .map((entry) => entry.card);
    return { status: "ok", data: { featured, categories: toCategoryVMs(categories, products), products: cards } };
  } catch (error) {
    if (error instanceof TransportUnavailableError) return { status: "unavailable", reason: error.reason };
    throw error;
  }
}

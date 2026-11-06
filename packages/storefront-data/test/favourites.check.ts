/*
 * Checks for the favourites store and the Favourites page's loader. No test runner is needed. From the repo root:
 *
 *   pnpm --filter @markaz/platform-kit exec tsx <absolute path to this file>
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import {
  FAVOURITES_MAX,
  FAVOURITES_PAGE_SIZE,
  FAVOURITES_STORAGE_VERSION,
  canFavourite,
  createFavouritesStore,
  favouritesKey,
  loadFavouriteProducts,
} from "../src/domain/favourites";
import type { FavouritesStorage } from "../src/domain/favourites";
import { mockTransport } from "../src/transport/mock";
import { createBffRoutes } from "../src/bff/handlers";
import { createRemoteTransport } from "../src/transport/remote";
import type { StorefrontProductSummary } from "../src/transport/types";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: FavouritesStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return { storage, data };
}

const KEY = favouritesKey("store-a");
assert.equal(KEY, "markaz-favourites:store-a");
assert.notEqual(favouritesKey("store-b"), KEY);

// Add, remove, toggle, clear, and what is stored: ids only, with the version.
{
  const { storage, data } = memoryStorage();
  const store = createFavouritesStore(KEY, () => storage);
  assert.deepEqual(store.getIds(), []);
  assert.equal(store.add("a"), true);
  assert.equal(store.add("a"), true);
  assert.equal(store.toggle("b"), true);
  assert.deepEqual(store.getIds(), ["a", "b"]);
  assert.deepEqual(JSON.parse(data.get(KEY) ?? ""), { version: FAVOURITES_STORAGE_VERSION, ids: ["a", "b"] });
  assert.equal(store.toggle("a"), false);
  store.remove("missing");
  assert.deepEqual(store.getIds(), ["b"]);
  store.clear();
  assert.deepEqual(store.getIds(), []);
  assert.equal(data.has(KEY), false);
}

// The list survives a reload, and each store has its own.
{
  const { storage } = memoryStorage();
  createFavouritesStore(KEY, () => storage).add("a");
  assert.deepEqual(createFavouritesStore(KEY, () => storage).getIds(), ["a"]);
  assert.deepEqual(createFavouritesStore(favouritesKey("store-b"), () => storage).getIds(), []);
}

// Two tabs do not overwrite each other.
{
  const { storage } = memoryStorage();
  const first = createFavouritesStore(KEY, () => storage);
  const second = createFavouritesStore(KEY, () => storage);
  first.getIds();
  second.getIds();
  first.add("a");
  second.add("b");
  assert.deepEqual(second.getIds(), ["a", "b"]);
}

// The cap: a full list refuses, and says so.
{
  const { storage } = memoryStorage();
  const store = createFavouritesStore(KEY, () => storage);
  for (let index = 0; index < FAVOURITES_MAX; index += 1) assert.equal(store.add("p" + index), true);
  assert.equal(store.add("one-more"), false);
  assert.equal(store.toggle("one-more"), false);
  assert.equal(store.getIds().length, FAVOURITES_MAX);
}

// A corrupt entry, another version and bad rows read as nothing, or as what is good in them.
for (const raw of ["not json", "null", "[]", '{"version":99,"ids":["a"]}', '{"version":1,"ids":"a"}']) {
  const { storage } = memoryStorage({ [KEY]: raw });
  assert.deepEqual(createFavouritesStore(KEY, () => storage).getIds(), [], raw);
}
{
  const { storage } = memoryStorage({ [KEY]: '{"version":1,"ids":["a",3,null,"a","b"]}' });
  assert.deepEqual(createFavouritesStore(KEY, () => storage).getIds(), ["a", "b"]);
}

// No storage, and storage that throws: the list works in memory and nothing escapes.
{
  const missing = createFavouritesStore(KEY, () => null);
  assert.equal(missing.add("a"), true);
  assert.deepEqual(missing.getIds(), ["a"]);

  const throwing: FavouritesStorage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  const blocked = createFavouritesStore(KEY, () => throwing);
  assert.deepEqual(blocked.getIds(), []);
  assert.equal(blocked.toggle("a"), true);
  assert.deepEqual(blocked.getIds(), ["a"]);
  blocked.clear();
  assert.deepEqual(blocked.getIds(), []);

  const denied = createFavouritesStore(KEY, () => {
    throw new Error("SecurityError");
  });
  assert.deepEqual(denied.getIds(), []);
}

// A stable reference between changes, and listeners hear each change once.
{
  const { storage } = memoryStorage();
  const store = createFavouritesStore(KEY, () => storage);
  let heard = 0;
  const stop = store.subscribe(() => {
    heard += 1;
  });
  store.add("a");
  const before = store.getIds();
  assert.equal(store.getIds(), before);
  store.add("a");
  assert.equal(heard, 1);
  stop();
  store.add("b");
  assert.equal(heard, 1);
}

// Prune takes only what it names.
{
  const { storage } = memoryStorage();
  const store = createFavouritesStore(KEY, () => storage);
  store.add("a");
  store.add("b");
  store.prune(["a", "not-there"]);
  assert.deepEqual(store.getIds(), ["b"]);
}

// A preview label hides the heart.
assert.equal(canFavourite(null), true);
assert.equal(canFavourite(undefined), true);
assert.equal(canFavourite("Draft"), false);
assert.equal(canFavourite("Sample product"), false);

const summary = (id: string): StorefrontProductSummary => ({
  id,
  slug: id,
  title: id,
  currency: "PKR",
  price: 1,
  compareAtPrice: null,
  stockStatus: "in_stock",
  defaultVariantId: "v",
  hasVariants: false,
  primaryImage: null,
  categories: [],
  avgRating: 0,
  reviewCount: 0,
});

async function main(): Promise<void> {
  // The loader: pages of 48, the saved order, and which ids have no product.
  const asked: string[][] = [];
  const ids = Array.from({ length: 100 }, (_, index) => "p" + index);
  const result = await loadFavouriteProducts(
    {
      getProductsByIds: async (page) => {
        asked.push(page);
        return page.filter((id) => id !== "p50").map(summary).reverse();
      },
    },
    ids,
  );
  assert.deepEqual(asked.map((page) => page.length), [FAVOURITES_PAGE_SIZE, FAVOURITES_PAGE_SIZE, 4]);
  assert.deepEqual(result.missing, ["p50"]);
  assert.equal(result.products[0]?.id, "p0");
  assert.equal(result.products.length, 99);

  // An outage rejects, so it can never read as products that are gone.
  await assert.rejects(
    loadFavouriteProducts(
      {
        getProductsByIds: async () => {
          throw new Error("down");
        },
      },
      ["a"],
    ),
  );
  assert.deepEqual(await loadFavouriteProducts({ getProductsByIds: async () => [] }, []), { products: [], missing: [] });

  // The mock answers from its fixtures.
  const [first] = await mockTransport.getProducts();
  assert.ok(first);
  assert.deepEqual((await mockTransport.getProductsByIds([first.id, "nope"])).map((product) => product.id), [first.id]);

  // Remote: the ids travel in the query of the products route, and no ids means no call.
  const urls: string[] = [];
  const remote = createRemoteTransport({
    baseUrl: "http://seller.test",
    storeId: "65a000000000000000000011",
    fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ data: [summary("a")], page: 1, totalPages: 1, totalDocs: 1, limit: 48 }), { status: 200 });
    },
  });
  assert.deepEqual(await remote.getProductsByIds([]), []);
  assert.equal(urls.length, 0);
  assert.equal((await remote.getProductsByIds(["a", "b"]))[0]?.id, "a");
  assert.equal(urls[0], "http://seller.test/api/storefront/v1/stores/65a000000000000000000011/products?ids=a,b");

  // The BFF: at most 48 ids, junk dropped, the backend's list passed on, and only a store host is served.
  const seen: string[][] = [];
  const routes = createBffRoutes({
    lookupStore: async () => ({
      outcome: "ok",
      transport: {
        ...mockTransport,
        getProductsByIds: async (requested) => {
          seen.push(requested);
          return [summary("a")];
        },
      },
    }),
  });
  const many = Array.from({ length: 60 }, (_, index) => "p" + index).join(",");
  const context = { tenantKey: "alpha-store", clientIp: null };
  const answer = await routes.products(new Request("http://alpha.test/api/storefront/products?ids=" + many + ",bad%20id"), context);
  assert.equal(answer.status, 200);
  assert.equal(seen[0]?.length, FAVOURITES_PAGE_SIZE);
  assert.equal(((await answer.json()) as { data: unknown[] }).data.length, 1);
  assert.equal((await routes.products(new Request("http://x.test/"), { tenantKey: null, clientIp: null })).status, 404);

  console.log("favourites checks passed");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

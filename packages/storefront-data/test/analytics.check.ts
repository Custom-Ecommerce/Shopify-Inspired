/*
 * Sprint 8 (S8-B6): checks for the anonymous counters on the storefront side: when nothing is sent (demo, preview, Do Not Track), one visit per browser
 * session, once per view, no cookie, errors swallowed, the BFF route and the remote transport. From packages/storefront-data run:
 *
 *   npx tsx test/analytics.check.ts        (or: pnpm test, which runs every *.check.ts)
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { createBffRoutes } from "../src/bff/handlers";
import { EVENT_PATH, VISIT_FLAG_PREFIX, browserSend, createStoreTracker, doNotTrackOn, oncePerView, type TrackerOptions } from "../src/domain/analytics";
import { BFF_BASE_PATH, createRemoteTransport } from "../src/transport/remote";
import type { OrderTransport } from "../src/transport/types";

const SITE = "http://alpha.localhost:3000";
const STORE = "65a000000000000000000011";

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

function world(extra: Partial<TrackerOptions> = {}) {
  const sent: string[] = [];
  const stored = new Map<string, string>();
  const options: TrackerOptions = {
    storeKey: STORE,
    preview: false,
    doNotTrack: () => false,
    storage: () => ({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) }),
    send: (body) => void sent.push(body),
    ...extra,
  };
  return { tracker: createStoreTracker(options), sent, stored, options };
}

check("a visit is one page_view per browser session of a store, remembered by a sessionStorage flag", () => {
  const { tracker, sent, stored, options } = world();
  tracker.visit();
  tracker.visit();
  createStoreTracker(options).visit();
  assert.deepEqual(sent, [JSON.stringify({ event: "page_view" })]);
  assert.deepEqual([...stored.keys()], [VISIT_FLAG_PREFIX + STORE]);
});

check("the body is the event and a slug only: no id, no cookie, nothing about the person", () => {
  const { tracker, sent } = world();
  tracker.track("product_view", "lawn-suit");
  tracker.track("add_to_cart");
  tracker.track("checkout_start", "ignored");
  tracker.track("product_view");
  assert.deepEqual(sent.map((body) => JSON.parse(body)), [{ event: "product_view", productSlug: "lawn-suit" }, { event: "add_to_cart" }, { event: "checkout_start" }]);
});

check("nothing is sent on a demo, in a preview or with Do Not Track", () => {
  for (const extra of [{ storeKey: undefined }, { preview: true }, { doNotTrack: () => true }] as Array<Partial<TrackerOptions>>) {
    const { tracker, sent, stored } = world(extra);
    tracker.visit();
    tracker.track("add_to_cart");
    tracker.track("product_view", "a");
    assert.equal(sent.length, 0);
    assert.equal(stored.size, 0);
  }
});

check("Do Not Track is read from the navigator and the window", () => {
  assert.equal(doNotTrackOn({ navigator: { doNotTrack: "1" } }), true);
  assert.equal(doNotTrackOn({ navigator: { msDoNotTrack: "1" } }), true);
  assert.equal(doNotTrackOn({ window: { doNotTrack: "yes" } }), true);
  for (const off of [{}, { navigator: { doNotTrack: "0" } }, { navigator: { doNotTrack: "unspecified" } }, { navigator: { doNotTrack: null }, window: null }]) assert.equal(doNotTrackOn(off), false);
});

check("every failure is swallowed, and with no storage no visit is counted rather than one per page", async () => {
  const broken = world({
    storage: () => {
      throw new Error("blocked");
    },
  });
  broken.tracker.visit();
  assert.equal(broken.sent.length, 0);
  const none = world({ storage: () => null });
  none.tracker.visit();
  assert.equal(none.sent.length, 0);
  world({
    send: () => {
      throw new Error("offline");
    },
  }).tracker.track("add_to_cart");
  world({ send: () => Promise.reject(new Error("offline")) }).tracker.track("add_to_cart");
  await new Promise((resolve) => setTimeout(resolve, 0));
});

check("once per view: a re-render sends nothing more, another product sends again, no product sends nothing", () => {
  const ref = { current: null as string | null };
  const seen: string[] = [];
  for (const key of [null, "a", "a", "b", "b", null, "b", "a"]) oncePerView(ref, key, () => seen.push(key as string));
  assert.deepEqual(seen, ["a", "b", "a"]);
});

check("the browser sends with keepalive and without cookies to the same-origin route", async () => {
  const calls: Array<[string, RequestInit]> = [];
  await browserSend((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push([String(url), init!]);
    return new Response("{}");
  }) as typeof fetch)('{"event":"add_to_cart"}');
  assert.equal(EVENT_PATH, BFF_BASE_PATH + "/events");
  assert.equal(calls[0]![0], EVENT_PATH);
  assert.equal(calls[0]![1].keepalive, true);
  assert.equal(calls[0]![1].credentials, "omit");
  assert.equal(calls[0]![1].method, "POST");
});

check("the server transport posts to /events with its own store id, once", async () => {
  const seen: Array<{ url: string; body: string }> = [];
  const make = (status: number) =>
    createRemoteTransport({
      baseUrl: "http://seller.test",
      storeId: STORE,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), body: String(init?.body) });
        return new Response(JSON.stringify({ data: { received: true } }), { status, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
  await make(200).recordEvent!({ event: "product_view", productSlug: "a" });
  assert.equal(seen[0]!.url, "http://seller.test/api/storefront/v1/events");
  assert.deepEqual(JSON.parse(seen[0]!.body), { store: STORE, event: "product_view", productSlug: "a" });
  await assert.rejects(make(503).recordEvent!({ event: "page_view" }));
  assert.equal(seen.length, 2, "never retried");
});

check("the BFF takes the store from the host and refuses a foreign origin, a store in the body and an unknown event", async () => {
  const got: unknown[] = [];
  const routes = createBffRoutes({
    lookupStore: async () => ({ outcome: "ok", transport: { recordEvent: async (input: unknown) => void got.push(input) } as unknown as OrderTransport }),
  });
  const post = (body: unknown, origin = SITE) =>
    routes.event(new Request(SITE + "/api/storefront/events", { method: "POST", headers: { origin, "x-forwarded-host": "alpha.localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) }), {
      tenantKey: "alpha",
      clientIp: null,
    });
  assert.equal((await post({ event: "page_view" })).status, 200);
  assert.deepEqual(got, [{ event: "page_view" }]);
  assert.equal((await post({ event: "page_view" }, "http://evil.test")).status, 403);
  for (const body of [{ event: "purchase" }, { event: "page_view", store: STORE }, { event: "product_view" }, { event: "page_view", visitorId: "x" }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(got.length, 1);
});

(async () => {
  for (const [name, run] of checks) {
    try {
      await run();
      console.log("ok  " + name);
    } catch (error) {
      console.error("FAIL  " + name);
      console.error(error);
      process.exit(1);
    }
  }
})();

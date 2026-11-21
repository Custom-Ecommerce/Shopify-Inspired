import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { ApiError, getOrder, listOrders } from "../lib/api/client";
import { NAV_GROUPS } from "../components/dashboard/nav-config";
import { ADMIN_ORDER_FORBIDDEN_KEYS } from "../lib/contracts";
import { ORDER_PAGE_SIZE, itemCountText, orderStateToQuery, orderTitle, parseOrderListState, paymentMethodText, rangeProblem, totalsLines } from "../lib/orders";

// Sprint 6 EP-12 (S6-B5): the read-only Orders page: pure helpers, the client and the same-origin routes. The backend is stubbed.

const ID = "65a0000000000000000a0001";
const STORE = "65a000000000000000000011";
const NOW = "2026-11-20T10:00:00.000Z";
const realFetch = globalThis.fetch;
const params = (query: string) => new URLSearchParams(query);

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});

const row = { id: ID, orderNumber: "ORD-ABCD2345", storeId: STORE, storeName: "Zara Lawn", status: "delivered", paymentMethod: "cod", total: 7250, city: "Lahore", itemCount: 2, createdAt: NOW, updatedAt: NOW };
const detail = { ...row, items: [{ name: "Lawn suit (Blue)", quantity: 2, unitPrice: 3500, lineTotal: 7000 }], totals: { subtotal: 7000, discount: 0, delivery: 250, total: 7250 }, statusHistory: [{ from: "pending", to: "delivered", at: NOW }], paymentStatus: "collected", confirmationStatus: "confirmed" };

test("the list state is read from the URL with safe fallbacks and written back without defaults", () => {
  assert.deepEqual(parseOrderListState(params("")), { page: 1, status: "", store: "", from: "", to: "", q: "" });
  const full = parseOrderListState(params("page=2&status=pending&store=" + STORE + "&from=2026-11-01&to=2026-11-30&q=ORD-1"));
  assert.deepEqual(full, { page: 2, status: "pending", store: STORE, from: "2026-11-01", to: "2026-11-30", q: "ORD-1" });
  assert.deepEqual(parseOrderListState(params("page=0&status=paid&store=x&from=yesterday&to=1")), { page: 1, status: "", store: "", from: "", to: "", q: "" });
  assert.equal(orderStateToQuery(parseOrderListState(params(""))), "");
  assert.equal(orderStateToQuery(full), "page=2&status=pending&store=" + STORE + "&from=2026-11-01&to=2026-11-30&q=ORD-1");
  assert.equal(orderStateToQuery(full, true).endsWith("&limit=" + ORDER_PAGE_SIZE), true);
  assert.equal(parseOrderListState(params("q=" + "x".repeat(80))).q.length, 40);
});

test("the page has no way to ask for a private field: the state has no phone, email or name", () => {
  const keys = Object.keys(parseOrderListState(params("phone=0300&email=a@b.c&customerName=A")));
  assert.deepEqual(keys, ["page", "status", "store", "from", "to", "q"]);
  assert.equal(orderStateToQuery(parseOrderListState(params("phone=0300&email=a@b.c"))), "");
});

test("a backwards date range is named; the wording is whole rupees", () => {
  assert.equal(rangeProblem({ from: "2026-11-30", to: "2026-11-01" }), "The start date is after the end date.");
  assert.equal(rangeProblem({ from: "2026-11-01", to: "" }), null);
  assert.equal(orderTitle({ orderNumber: "ORD-1", total: 7250 }), "Order ORD-1 · Rs. 7,250");
  assert.deepEqual([itemCountText(1), itemCountText(3)], ["1 item", "3 items"]);
  assert.deepEqual([paymentMethodText("cod"), paymentMethodText("card"), paymentMethodText(null)], ["Cash on delivery", "Card", "Not set"]);
  assert.deepEqual(totalsLines({ subtotal: 7000, discount: 0, delivery: 250, total: 7250 }).map((l) => l.label), ["Subtotal", "Delivery", "Total"]);
  assert.deepEqual(totalsLines({ subtotal: 7000, discount: 500, delivery: 250, total: 6750 })[1], { label: "Discount", value: "- Rs. 500" });
});

test("the page and its helpers never name a private field: no phone, address, email or customer name in the view, the lib or the routes", () => {
  for (const file of ["components/orders/orders-view.tsx", "lib/orders.ts", "app/api/orders/route.ts", "app/api/orders/[id]/route.ts"]) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const key of ["phone", "customerName", "customerEmail", "address"]) assert.equal(new RegExp("\\b" + key + "\\b", "i").test(source.replace(/never (a|show)[^\n]*/gi, "").replace(/\*[^\n]*/g, "")), false, file + " mentions " + key);
  }
  assert.ok(ADMIN_ORDER_FORBIDDEN_KEYS.includes("phone" as never));
});

test("the navigation has the Orders page", () => {
  const entry = NAV_GROUPS.flatMap((g) => g.items).find((item) => item.href === "/orders");
  assert.ok(entry && entry.status === "live");
});

function stub(status: number, payload: unknown): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("the client lists and reads orders and checks the shape; a refusal keeps its words", async () => {
  const calls = stub(200, { docs: [row], page: 1, limit: 20, totalDocs: 1, totalPages: 1 });
  const list = await listOrders({ page: 1, status: "pending", store: "", from: "", to: "", q: "" });
  assert.equal(calls[0]!.url, "/api/orders?status=pending&limit=20");
  assert.equal(list.docs[0]!.total, 7250);
  stub(200, { docs: [{ ...row, phone: "0300" }], page: 1, limit: 20, totalDocs: 1, totalPages: 1 });
  await assert.rejects(() => listOrders({ page: 1, status: "", store: "", from: "", to: "", q: "" }), (e: unknown) => e instanceof ApiError && e.status === 502, "a private key in a row is refused by the strict contract");
  stub(200, { order: detail });
  assert.equal((await getOrder(ID)).items[0]!.lineTotal, 7000);
  stub(404, { error: "Order not found" });
  await assert.rejects(() => getOrder(ID), (e: unknown) => e instanceof ApiError && e.status === 404);
});

let listGET: (r: NextRequest) => Promise<Response>;
let detailGET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  listGET = (await import("../app/api/orders/route")).GET;
  detailGET = (await import("../app/api/orders/[id]/route")).GET;
});
const req = (p: string, cookie = "markaz-admin-session=tok") => new NextRequest("http://admin.local/api/orders" + p, { headers: cookie ? { cookie } : {} });

test("the list route forwards only the known filters (a phone or an email filter is dropped) and needs the session", async () => {
  const calls = stub(200, { docs: [] });
  assert.equal((await listGET(req("?status=pending&q=ORD&phone=0300&email=a@b.c&customerName=A&limit=20"))).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/orders?status=pending&q=ORD&limit=20");
  assert.equal((await listGET(req("", ""))).status, 401);
  assert.equal(calls.length, 1);
});

test("the detail route forwards a valid id, refuses a bad one before the backend, and needs the session", async () => {
  const calls = stub(200, { order: detail });
  assert.equal((await detailGET(req("/" + ID), { params: Promise.resolve({ id: ID }) })).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/orders/" + ID);
  assert.equal((await detailGET(req("/x"), { params: Promise.resolve({ id: "x" }) })).status, 404);
  assert.equal((await detailGET(req("/" + ID, ""), { params: Promise.resolve({ id: ID }) })).status, 401);
  assert.equal(calls.length, 1);
});

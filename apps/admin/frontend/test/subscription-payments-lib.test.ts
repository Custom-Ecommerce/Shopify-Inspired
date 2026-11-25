import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AdminPayment } from "@markaz/contracts";
import { ApiError, listSubscriptionPayments, runPaymentAction } from "../lib/api/client";
import { NAV_GROUPS, pageTitleFor } from "../components/dashboard/nav-config";
import {
  DEFAULT_PAYMENT_FILTER,
  PAYMENT_ACTION_COPY,
  PAYMENT_BADGE_STATUS,
  PAYMENT_PAGE_SIZE,
  PAYMENT_REASON_MIN,
  availablePaymentActions,
  confirmBody,
  confirmFacts,
  confirmProblems,
  decideBody,
  formatRs,
  methodLabel,
  parsePaymentListState,
  paymentApiQuery,
  paymentStateToQuery,
  reasonProblem,
  safeProofHref,
} from "../lib/subscription-payments";
import { toneOf } from "../lib/status";

// Sprint 6 EP-14 (S6-B4, D-118): the wording, checks and requests of the Subscription payments page, and its client. Pure functions and a stubbed fetch.

const ID = "65a0000000000000000e0001";
const SELLER = "65a000000000000000000001";
const NOW = "2026-11-20T10:00:00.000Z";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const payment: AdminPayment = {
  id: ID,
  seller: { id: SELLER, name: "Ayesha <b>Khan</b>", email: "ayesha@example.com" },
  planKey: "growth",
  planName: "Growth",
  amountRs: 2500,
  status: "claimed",
  method: "jazzcash",
  reference: "TX-77812",
  proofUrl: "https://example.com/slip.jpg",
  periodStart: null,
  periodEnd: null,
  reason: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: NOW,
  claimedAt: NOW,
  revision: 1,
};

const params = (query: string) => new URLSearchParams(query);

test("the list opens on the payments to check; a bad page or status falls back, and all is a choice of its own", () => {
  assert.equal(DEFAULT_PAYMENT_FILTER, "claimed");
  assert.deepEqual(parsePaymentListState(params("")), { page: 1, status: "claimed" });
  assert.deepEqual(parsePaymentListState(params("page=3&status=confirmed")), { page: 3, status: "confirmed" });
  assert.deepEqual(parsePaymentListState(params("status=all")), { page: 1, status: "all" });
  assert.deepEqual(parsePaymentListState(params("page=0&status=paid")), { page: 1, status: "claimed" });
  assert.deepEqual(parsePaymentListState(params("page=abc")), { page: 1, status: "claimed" });
  assert.deepEqual(parsePaymentListState(params("page=1234567")), { page: 1, status: "claimed" });
});

test("the page URL leaves the defaults out; the API call always says the status and the page size", () => {
  assert.equal(paymentStateToQuery({ page: 1, status: "claimed" }), "");
  assert.equal(paymentStateToQuery({ page: 2, status: "all" }), "page=2&status=all");
  assert.equal(paymentStateToQuery({ page: 1, status: "void" }), "status=void");
  assert.equal(paymentApiQuery({ page: 1, status: "claimed" }), "status=claimed&limit=" + PAYMENT_PAGE_SIZE);
  assert.equal(paymentApiQuery({ page: 3, status: "all" }), "page=3&limit=" + PAYMENT_PAGE_SIZE);
});

test("the actions follow the status: confirm and reject a claimed payment, reject an unclaimed one, void a confirmed one, nothing else", () => {
  assert.deepEqual(availablePaymentActions({ status: "claimed" }), ["confirm", "reject"]);
  assert.deepEqual(availablePaymentActions({ status: "requested" }), ["reject"]);
  assert.deepEqual(availablePaymentActions({ status: "confirmed" }), ["void"]);
  assert.deepEqual(availablePaymentActions({ status: "rejected" }), []);
  assert.deepEqual(availablePaymentActions({ status: "void" }), []);
  for (const action of ["confirm", "reject", "void"] as const) assert.ok(PAYMENT_ACTION_COPY[action].confirm.length > 0);
});

test("a reason is 3 or more characters to confirm and 5 or more to reject or void, at most 300, with no angle brackets", () => {
  assert.deepEqual(PAYMENT_REASON_MIN, { confirm: 3, reject: 5, void: 5 });
  assert.equal(reasonProblem("confirm", "ok!"), null);
  assert.equal(reasonProblem("confirm", "ok"), "Give a reason of at least 3 characters.");
  assert.equal(reasonProblem("reject", "four"), "Give a reason of at least 5 characters.");
  assert.equal(reasonProblem("void", "  fives  "), null, "trimmed first (5 characters)");
  assert.equal(reasonProblem("void", "    x    "), "Give a reason of at least 5 characters.");
  assert.match(reasonProblem("reject", "x".repeat(301)) ?? "", /at most 300/);
  assert.match(reasonProblem("reject", "<b>wrong</b>") ?? "", /plain text/);
});

test("confirm needs the box ticked and a reason", () => {
  assert.deepEqual(confirmProblems({ checked: true, reason: "Slip checked" }), {});
  assert.deepEqual(confirmProblems({ checked: false, reason: "Slip checked" }), { checked: "Tick the box once you have seen the money in your account." });
  assert.deepEqual(Object.keys(confirmProblems({ checked: false, reason: "" })).sort(), ["checked", "reason"]);
});

test("a confirm carries the amount the operator SAW and the trimmed reason; reject and void carry the reason only", () => {
  assert.deepEqual(confirmBody(payment, "  Slip checked  "), { amountRs: 2500, reason: "Slip checked" });
  assert.deepEqual(decideBody("  Amount does not match "), { reason: "Amount does not match" });
  assert.equal("amountRs" in decideBody("x"), false);
});

test("the confirm dialog repeats the seller, plan, amount, method and reference; seller names are plain text, not markup", () => {
  const facts = confirmFacts(payment);
  assert.deepEqual(facts.map((fact) => fact.label), ["Seller", "Plan", "Amount", "Paid by", "Reference"]);
  assert.deepEqual(facts.map((fact) => fact.value), ["Ayesha <b>Khan</b> (ayesha@example.com)", "Growth", "Rs. 2,500", "JazzCash", "TX-77812"]);
  const nameless = confirmFacts({ ...payment, seller: { ...payment.seller, name: "" }, method: null, reference: null });
  assert.deepEqual([nameless[0]!.value, nameless[3]!.value, nameless[4]!.value], ["ayesha@example.com", "Not stated", "Not stated"]);
});

test("money is whole rupees with a fixed locale; a method has its label and an unknown one is shown as it is", () => {
  assert.equal(formatRs(2500), "Rs. 2,500");
  assert.equal(formatRs(6000), "Rs. 6,000");
  assert.deepEqual(["bank", "jazzcash", "easypaisa", "other", null, "cheque"].map(methodLabel), ["Bank transfer", "JazzCash", "Easypaisa", "Other", "Not stated", "cheque"]);
});

test("a receipt link is a link only when it is https; anything else is shown as text", () => {
  assert.equal(safeProofHref("https://example.com/slip.jpg"), "https://example.com/slip.jpg");
  for (const bad of ["http://example.com/a", "javascript:alert(1)", "//example.com", "ftp://x.test", "https://a b.test", null]) assert.equal(safeProofHref(bad), null, String(bad));
});

test("each payment status has a badge colour the console already knows: waiting is amber, confirmed green, rejected red", () => {
  assert.deepEqual(Object.values(PAYMENT_BADGE_STATUS).map(toneOf), ["neutral", "warning", "success", "danger", "neutral"]);
});

test("the console's navigation has the page, and its title is the entry's", () => {
  const items = NAV_GROUPS.flatMap((group) => group.items);
  const entry = items.find((item) => item.href === "/subscription-payments");
  assert.ok(entry);
  assert.equal(entry!.status, "live");
  assert.equal(pageTitleFor("/subscription-payments"), "Subscription payments");
  assert.equal(pageTitleFor("/subscriptions"), "Subscriptions", "the plans page keeps its own title");
});

// ----------------------------------------------------------------------------------------------------------------------------- the client

function stub(status: number, payload: unknown): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const list = { docs: [payment], page: 1, limit: 20, totalDocs: 1, totalPages: 1, pendingCount: 1 };

test("the client lists payments with the status and the page size, and checks the shape that comes back", async () => {
  const calls = stub(200, list);
  const result = await listSubscriptionPayments({ page: 2, status: "confirmed" });
  assert.equal(calls[0]!.url, "/api/subscription-payments?status=confirmed&page=2&limit=20");
  assert.deepEqual([result.pendingCount, result.docs[0]!.amountRs], [1, 2500]);
  stub(200, { docs: [{ ...payment, amountRs: 12.5 }], page: 1, limit: 20, totalDocs: 1, totalPages: 1, pendingCount: 0 });
  await assert.rejects(() => listSubscriptionPayments({ page: 1, status: "all" }), (err: unknown) => err instanceof ApiError && err.status === 502);
});

test("the client posts one action to the payment's own path with the body it was given", async () => {
  const calls = stub(200, { payment: { ...payment, status: "confirmed" } });
  const result = await runPaymentAction("confirm", ID, { amountRs: 2500, reason: "Slip checked" });
  assert.equal(result.payment.status, "confirmed");
  assert.equal(calls[0]!.url, "/api/subscription-payments/" + ID + "/confirm");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { amountRs: 2500, reason: "Slip checked" });
  stub(200, { payment: { ...payment, status: "rejected" } });
  await runPaymentAction("reject", ID, { reason: "Amount does not match" });
});

test("a refusal keeps its status and the backend's own words, so the operator sees why", async () => {
  stub(409, { error: "Someone else already decided this payment. Reload the list." });
  await assert.rejects(
    () => runPaymentAction("confirm", ID, { amountRs: 2500, reason: "Slip checked" }),
    (err: unknown) => err instanceof ApiError && err.status === 409 && /Someone else already decided/.test(err.message),
  );
  stub(422, { error: "Give a reason of at least 5 characters.", issues: [{ path: "reason", message: "Give a reason of at least 5 characters." }] });
  await assert.rejects(
    () => runPaymentAction("reject", ID, { reason: "no" }),
    (err: unknown) => err instanceof ApiError && err.status === 422 && err.issues[0]?.path === "reason",
  );
});

test('the confirm dialog wraps a long email or reference inside itself: the value column may shrink below its longest word (375 px)', async () => {
  const { readFileSync } = await import('node:fs');
  const view = readFileSync(process.cwd() + '/components/subscription-payments/payments-view.tsx', 'utf8');
  const facts = /<dl className="([^"]*)" data-slot="confirm-facts">/.exec(view)?.[1] ?? '';
  assert.ok(facts.includes('grid-cols-[auto_minmax(0,1fr)]'), facts);
  assert.match(view, /<dd className="break-words font-medium">\{fact\.value\}<\/dd>/);
});

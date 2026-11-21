import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  PLAN_LIMIT_EVENT,
  announcePlanLimit,
  bannerNeedsAction,
  bannerText,
  planLimitFrom,
  readPlanUsage,
  upgradeSummary,
  upgradeTitle,
  usageBar,
  usageBars,
} from "../lib/plan-usage";
import { proxyGet } from "../lib/proxy";

// Sprint 6 EP-14.US02 (D-118): the plan banner, the usage bars and the upgrade hint. Pure functions, plus the proxy keeping the numbers of a refusal.

const body = {
  plan: { key: "growth", name: "Growth" },
  status: "active",
  subscribedPlanKey: "growth",
  limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true },
  used: { stores: 1, products: 12, staffSeats: 0, apiKeys: 0 },
  periodEnd: "2026-12-01T00:00:00.000Z",
  graceUntil: null,
  daysLeft: 11,
  storeLimitOverridden: false,
  fallbackLimits: false,
};

test("the backend's answer is read, and anything unusable is null (the banner is then not shown)", () => {
  const usage = readPlanUsage(body)!;
  assert.deepEqual([usage.plan.key, usage.status, usage.daysLeft, usage.limits.products, usage.used.products], ["growth", "active", 11, null, 12]);
  for (const bad of [null, "x", {}, { ...body, status: "paused" }, { ...body, plan: { key: 5 } }, { ...body, used: { ...body.used, stores: -1 } }, { ...body, limits: { ...body.limits, stores: 1.5 } }, { ...body, used: null }]) {
    assert.equal(readPlanUsage(bad), null, JSON.stringify(bad));
  }
  assert.equal(readPlanUsage({ ...body, daysLeft: -3 })?.daysLeft, null);
  assert.equal(readPlanUsage({ ...body, subscribedPlanKey: undefined })?.subscribedPlanKey, null);
});

test("a usage bar: percent, tone and text; unlimited has nothing to fill; the limit is full; past it is over", () => {
  assert.deepEqual(usageBar("Products", 3, 10), { label: "Products", used: 3, limit: 10, percent: 30, tone: "ok", text: "3 of 10" });
  assert.equal(usageBar("Products", 8, 10).tone, "near");
  assert.equal(usageBar("Products", 7, 10).tone, "ok");
  assert.deepEqual([usageBar("Products", 10, 10).tone, usageBar("Products", 10, 10).percent], ["full", 100]);
  assert.deepEqual([usageBar("Products", 14, 10).tone, usageBar("Products", 14, 10).percent], ["over", 100]);
  assert.deepEqual(usageBar("Products", 12, null), { label: "Products", used: 12, limit: null, percent: 0, tone: "ok", text: "12 (unlimited)" });
  assert.deepEqual([usageBar("Stores", 0, 0).tone, usageBar("Stores", 0, 0).percent], ["full", 100], "a limit of 0 is full from the start");
});

test("the two bars are stores and products, and staff seats and API keys are not shown yet", () => {
  const bars = usageBars(readPlanUsage(body)!);
  assert.deepEqual(bars.map((bar) => bar.label), ["Stores", "Products"]);
  assert.deepEqual(bars.map((bar) => bar.text), ["1 of 3", "12 (unlimited)"]);
});

test("the banner says what the seller needs to hear for every status", () => {
  const base = { plan: { key: "free", name: "Free" }, subscribedPlanKey: "growth" };
  assert.deepEqual(bannerText({ ...base, plan: { key: "growth", name: "Growth" }, status: "active", daysLeft: 11 }), { headline: "Growth plan", detail: "Your plan runs for 11 days more." });
  assert.equal(bannerText({ ...base, plan: { key: "growth", name: "Growth" }, status: "active", daysLeft: 0 }).detail, "Your plan ends today.");
  assert.equal(bannerText({ ...base, plan: { key: "growth", name: "Growth" }, status: "trial", daysLeft: 4 }).headline, "Growth plan (trial)");
  assert.match(bannerText({ ...base, plan: { key: "growth", name: "Growth" }, status: "trial", daysLeft: 4 }).detail, /ends in 4 days/);
  assert.match(bannerText({ ...base, plan: { key: "growth", name: "Growth" }, status: "grace", daysLeft: 3 }).detail, /keep your plan's limits for 3 days more/);
  assert.match(bannerText({ ...base, status: "expired", daysLeft: null }).detail, /Nothing was deleted/);
  assert.equal(bannerText({ ...base, status: "expired", daysLeft: null }).headline, "Your plan has expired");
  assert.equal(bannerText({ ...base, status: "cancelled", daysLeft: null }).headline, "Your subscription was cancelled");
  assert.deepEqual(bannerText({ plan: { key: "free", name: "Free" }, subscribedPlanKey: null, status: "none", daysLeft: null }), { headline: "Free plan", detail: "Upgrade when you need more stores or products." });
});

test("the banner asks for attention only when payment is due or the limits were lost", () => {
  assert.deepEqual(
    (["trial", "active", "grace", "expired", "cancelled", "none"] as const).map(bannerNeedsAction),
    [false, false, true, true, true, false],
  );
});

// ----------------------------------------------------------------------------------------------------------- the upgrade hint

const refusal = { error: "Your Free plan allows 10 products and you have 10.", code: "PLAN_LIMIT_REACHED", details: { limitKind: "products", limit: 10, used: 10, plan: "free", upgradeHint: "Upgrade to Growth (Rs. 2,500 / month) for unlimited products." } };

test("a refused add is read from the console's answer, and from the backend's own", () => {
  const info = planLimitFrom(refusal)!;
  assert.deepEqual([info.limitKind, info.limit, info.used, info.plan], ["products", 10, 10, "free"]);
  assert.match(info.upgradeHint, /Upgrade to Growth/);
  assert.match(info.message, /Free plan allows 10/);
  const direct = planLimitFrom({ errors: [{ message: "Plan limit." }], code: "PLAN_LIMIT_REACHED", limitKind: "stores", limit: 1, used: 1, plan: "free", upgradeHint: "Upgrade." })!;
  assert.deepEqual([direct.limitKind, direct.limit, direct.message], ["stores", 1, "Plan limit."]);
});

test("any other answer is not a plan limit", () => {
  for (const other of [null, "x", {}, { code: "STORE_LIMIT_REACHED" }, { code: "VALIDATION_ERROR", error: "bad" }]) assert.equal(planLimitFrom(other), null);
  assert.equal(announcePlanLimit({ code: "FORBIDDEN" }), false);
});

test("a refusal with missing numbers still gets a sensible hint", () => {
  const info = planLimitFrom({ code: "PLAN_LIMIT_REACHED", error: "No more.", details: {} })!;
  assert.deepEqual([info.limit, info.used, info.plan, info.limitKind], [null, null, null, null]);
  assert.equal(info.upgradeHint, "Upgrade your plan for a higher limit.");
  assert.equal(upgradeSummary(info), "No more.");
});

test("the dialog's title and summary say which limit and how much", () => {
  assert.equal(upgradeTitle({ limitKind: "products" }), "You have reached your product limit");
  assert.equal(upgradeTitle({ limitKind: "stores" }), "You have reached your store limit");
  assert.equal(upgradeTitle({ limitKind: null }), "You have reached your plan limit");
  assert.equal(upgradeSummary({ limitKind: "products", limit: 10, used: 10, plan: "free" }), "You have 10 of 10 products on the free plan.");
  assert.equal(upgradeSummary({ limitKind: "stores", limit: 1, used: 1, plan: null }), "You have 1 of 1 stores.");
});

test("announcing a refusal opens the dialog through one window event, and does nothing without a window", () => {
  assert.equal(announcePlanLimit(refusal), true, "safe on the server: no window, still recognised");
  const seen: unknown[] = [];
  const target = new EventTarget();
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = target;
  try {
    target.addEventListener(PLAN_LIMIT_EVENT, (event) => seen.push((event as CustomEvent).detail));
    assert.equal(announcePlanLimit(refusal), true);
    assert.equal(announcePlanLimit({ code: "OTHER" }), false);
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { plan: string }).plan, "free");
});

// ------------------------------------------------------------------------------------------------------- the proxy keeps the numbers

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the proxy keeps the limit, the use, the plan and the hint of a PLAN_LIMIT_REACHED answer in details", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ errors: [{ message: "Your Free plan allows 10 products and you have 10." }], code: "PLAN_LIMIT_REACHED", limitKind: "products", limit: 10, used: 10, plan: "free", upgradeHint: "Upgrade to Growth." }),
      { status: 403, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const res = await proxyGet(new NextRequest("http://seller.test/api/proxy/x"), "/api/products", { auth: "none" });
  assert.equal(res.status, 403);
  const json = (await res.json()) as { code: string; error: string; details: Record<string, unknown> };
  assert.equal(json.code, "PLAN_LIMIT_REACHED");
  assert.match(json.error, /Free plan allows 10/);
  assert.deepEqual(json.details, { limitKind: "products", limit: 10, used: 10, plan: "free", upgradeHint: "Upgrade to Growth." });
  const info = planLimitFrom(json)!;
  assert.deepEqual([info.limit, info.used, info.plan], [10, 10, "free"]);
});

test("another 403 keeps its own details, untouched by the plan limit rule", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "Forbidden" }], code: "FORBIDDEN", limit: 99 }), { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch;
  const res = await proxyGet(new NextRequest("http://seller.test/api/proxy/x"), "/api/products", { auth: "none" });
  const json = (await res.json()) as { code: string; details: unknown };
  assert.equal(json.code, "FORBIDDEN");
  assert.deepEqual(json.details, [{ message: "Forbidden" }]);
});

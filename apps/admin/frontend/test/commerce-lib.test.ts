import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionStateToUrl, entryCountLabel, ledgerStateToQuery, parseCommissionState, ratesStateToQuery } from "../lib/commission";
import { parseSubscriptionState, subscriptionStateToQuery } from "../lib/subscriptions";
import { formatMoney } from "../lib/format";
import { toneOf } from "../lib/status";
import { NAV_GROUPS } from "../components/dashboard/nav-config";

test("the commission state defaults to the ledger with no filters", () => {
  assert.deepEqual(parseCommissionState(new URLSearchParams()), { view: "ledger", page: 1, q: "", status: "", mode: "" });
});

test("the ledger keeps a valid status and drops the rates filter, and the rates view does the reverse", () => {
  assert.deepEqual(parseCommissionState(new URLSearchParams("status=settled&mode=custom&page=3&q=%20looms%20")), { view: "ledger", page: 3, q: "looms", status: "settled", mode: "" });
  assert.deepEqual(parseCommissionState(new URLSearchParams("view=rates&status=settled&mode=custom")), { view: "rates", page: 1, q: "", status: "", mode: "custom" });
});

test("unreadable commission values fall back to the defaults", () => {
  assert.equal(parseCommissionState(new URLSearchParams("view=ledgers")).view, "ledger");
  assert.equal(parseCommissionState(new URLSearchParams("status=paid")).status, "");
  assert.equal(parseCommissionState(new URLSearchParams("view=rates&mode=%24ne")).mode, "");
  assert.equal(parseCommissionState(new URLSearchParams("page=0")).page, 1);
  assert.equal(parseCommissionState(new URLSearchParams("q=" + "a".repeat(300))).q.length, 100);
});

test("the page URL leaves out the defaults and the filters of the other view", () => {
  assert.equal(commissionStateToUrl({ view: "ledger", page: 1, q: "", status: "", mode: "" }), "");
  assert.equal(commissionStateToUrl({ view: "ledger", page: 2, q: "a b", status: "pending", mode: "custom" }), "page=2&q=a+b&status=pending");
  assert.equal(commissionStateToUrl({ view: "rates", page: 2, q: "", status: "settled", mode: "custom" }), "view=rates&page=2&mode=custom");
});

test("the API queries carry only the filters of their own view, and the limit when asked", () => {
  assert.equal(ledgerStateToQuery({ view: "ledger", page: 1, q: "", status: "", mode: "" }), "");
  assert.equal(ledgerStateToQuery({ view: "ledger", page: 2, q: "a b", status: "settled", mode: "" }, true), "page=2&q=a+b&status=settled&limit=20");
  assert.equal(ratesStateToQuery({ view: "rates", page: 1, q: "x", status: "", mode: "custom" }, true), "q=x&mode=custom&limit=20");
  assert.equal(ratesStateToQuery({ view: "rates", page: 1, q: "", status: "", mode: "" }), "");
});

test("the subscription state keeps a valid tier only, and the default stays out of the query", () => {
  assert.deepEqual(parseSubscriptionState(new URLSearchParams("tier=pro&page=2&q=%20monthly%20")), { page: 2, q: "monthly", tier: "pro" });
  assert.equal(parseSubscriptionState(new URLSearchParams("tier=gold")).tier, "");
  assert.equal(subscriptionStateToQuery({ page: 1, q: "", tier: "" }), "");
  assert.equal(subscriptionStateToQuery({ page: 3, q: "a b", tier: "premium" }, true), "page=3&q=a+b&tier=premium&limit=20");
});

test("money is minor units shown as major units, and a refund shows its sign", () => {
  assert.match(formatMoney(123450), /1,234\.50/);
  assert.match(formatMoney(0), /0\.00/);
  assert.match(formatMoney(-5000), /-.*50\.00|50\.00.*-/);
  assert.equal(formatMoney(Number.NaN), "-");
});

test("a settled ledger entry is a success tone, and a pending one a warning", () => {
  assert.equal(toneOf("settled"), "success");
  assert.equal(toneOf("pending"), "warning");
});

test("the entry count reads naturally", () => {
  assert.equal(entryCountLabel(1), "1 entry");
  assert.equal(entryCountLabel(0), "0 entries");
  assert.equal(entryCountLabel(12), "12 entries");
});

test("the commerce navigation items are live links now", () => {
  const items = NAV_GROUPS.flatMap((group) => group.items);
  for (const href of ["/commission", "/subscriptions"]) {
    const item = items.find((entry) => entry.href === href);
    assert.equal(item?.status, "live", href);
  }
});

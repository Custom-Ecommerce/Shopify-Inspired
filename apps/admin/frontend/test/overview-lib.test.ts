import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KPI_PERIODS, kpiTiles, planRows, topStoreRows, outboxRows, overviewTiles, storeRows, storeStatusHref, syncStatusHref, updatedLabel } from "../lib/overview";
import type { AdminOverview } from "../lib/contracts";

const NOW = new Date("2026-10-11T10:00:00.000Z");
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const overview: AdminOverview = {
  stores: { total: 8, byStatus: { pending: 2, active: 5, suspended: 1, archived: 0 } },
  sellers: { total: 7, newInWindow: 2, windowDays: 30 },
  kpi: {
    periods: {
      today: { gatewaySales: 1000, commission: 40, gatewayOrders: 1, codOrderValue: 2000, codOrders: 2 },
      last7: { gatewaySales: 7000, commission: 280, gatewayOrders: 7, codOrderValue: 14000, codOrders: 14 },
      last30: { gatewaySales: 20000, commission: 800, gatewayOrders: 20, codOrderValue: 30000, codOrders: 30 },
    },
    ordersByPeriod: { today: 3, last7: 21, last30: 50 },
    unsettledBalance: -1200,
    ordersByStatus: { pending: 4, confirmed: 0, processing: 0, dispatched: 0, delivered: 9, cancelled: 0, returned: 0 },
    sellersByPlan: [{ planKey: "growth", status: "active", count: 3 }, { planKey: "free", status: "none", count: 4 }],
    topStores: [{ storeId: "65a000000000000000000011", storeName: "Zara Lawn", sales: 50000 }],
  },
  outbox: { counts: { pending: 1, sent: 10, dead: 0 }, oldestPendingAt: iso(1), lastSentAt: iso(1) },
  generatedAt: NOW.toISOString(),
};

const empty: AdminOverview = {
  stores: { total: 0, byStatus: { pending: 0, active: 0, suspended: 0, archived: 0 } },
  sellers: { total: 0, newInWindow: 0, windowDays: 30 },
  kpi: null,
  outbox: { counts: { pending: 0, sent: 0, dead: 0 }, oldestPendingAt: null, lastSentAt: null },
  generatedAt: NOW.toISOString(),
};

test("there are three tiles in a fixed order, each linking to its page; none reads the old ledger", () => {
  const tiles = overviewTiles(overview, NOW);
  assert.deepEqual(tiles.map((tile) => tile.key), ["stores", "sellers", "sync"]);
  assert.deepEqual(tiles.map((tile) => tile.href), ["/stores", "/sellers", "/sync"]);
  assert.equal(tiles.some((tile) => /commission|ledger/i.test(tile.title + tile.hint)), false);
});

test("the stores tile shows the total, the active and pending counts, and flags suspended stores", () => {
  const [stores] = overviewTiles(overview, NOW);
  assert.equal(stores.value, "8");
  assert.equal(stores.hint, "5 active, 2 pending");
  assert.deepEqual(stores.badge, { label: "1 suspended", tone: "warning" });
  assert.equal(overviewTiles(empty, NOW)[0].badge, null);
});

test("the sellers tile shows the total and the new sellers in the window", () => {
  const sellers = overviewTiles(overview, NOW)[1];
  assert.equal(sellers.value, "7");
  assert.equal(sellers.hint, "2 new in the last 30 days");
  assert.equal(sellers.badge, null);
});

test("the sync tile follows the one health rule: healthy, backlog, then dead letters", () => {
  assert.equal(overviewTiles(overview, NOW)[2].value, "Healthy");
  assert.equal(overviewTiles(overview, NOW)[2].badge, null);
  const backlog = overviewTiles({ ...overview, outbox: { ...overview.outbox, oldestPendingAt: iso(30) } }, NOW)[2];
  assert.equal(backlog.value, "Backlog");
  const dead = overviewTiles({ ...overview, outbox: { ...overview.outbox, counts: { pending: 1, sent: 10, dead: 2 } } }, NOW)[2];
  assert.equal(dead.value, "Needs attention");
  assert.deepEqual(dead.badge, { label: "2 dead", tone: "danger" });
  assert.equal(overviewTiles(empty, NOW)[2].value, "Healthy");
});

test("each breakdown row links to its list on that status", () => {
  assert.equal(storeStatusHref("suspended"), "/stores?status=suspended");
  assert.equal(syncStatusHref("pending"), "/sync?status=pending");
  assert.equal(syncStatusHref("dead"), "/sync");
});

test("stores by status lists all four statuses with their counts", () => {
  const rows = storeRows(overview);
  assert.deepEqual(rows.map((row) => [row.status, row.label, row.count]), [
    ["pending", "Pending", "2"],
    ["active", "Active", "5"],
    ["suspended", "Suspended", "1"],
    ["archived", "Archived", "0"],
  ]);
  assert.equal(rows[1].href, "/stores?status=active");
});

test("the outbox rows list pending, sent, and dead letters with the sync page filter", () => {
  const rows = outboxRows({ ...overview, outbox: { ...overview.outbox, counts: { pending: 1, sent: 10, dead: 2 } } });
  assert.deepEqual(rows.map((row) => [row.status, row.label, row.count, row.href]), [
    ["pending", "Pending", "1", "/sync?status=pending"],
    ["sent", "Sent", "10", "/sync?status=sent"],
    ["dead", "Dead letter", "2", "/sync"],
  ]);
});

test("the freshness label is relative to the time the backend read the numbers", () => {
  assert.equal(updatedLabel(NOW.toISOString(), NOW), "Updated just now");
  assert.equal(updatedLabel(iso(5), NOW), "Updated 5 minutes ago");
});

test("the overview page is live: no placeholder copy, and it renders the overview view", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "app", "(dashboard)", "page.tsx"), "utf8");
  assert.match(page, /OverviewView/);
  assert.doesNotMatch(page, /arrive with|AF1|AF2|Console foundation/);
});

test("the overview view shows no ledger tile or ledger rows (SB-12: they read the old ledger)", () => {
  const view = fs.readFileSync(path.join(process.cwd(), "components", "overview", "overview-view.tsx"), "utf8");
  assert.doesNotMatch(view, /ledgerRows|Commission ledger/);
  const lib = fs.readFileSync(path.join(process.cwd(), "lib", "overview.ts"), "utf8");
  assert.doesNotMatch(lib, /ledgerRows|ledgerStatusHref/);
});

// ------------------------------------------------------------------------------------------------ Sprint 6 (S6-B5): the KPI tiles

test("S6-B5: the KPI switch has today, 7 days and 30 days, and the tiles follow the chosen period, in whole rupees", () => {
  assert.deepEqual(KPI_PERIODS.map((p) => p.key), ["today", "last7", "last30"]);
  const today = kpiTiles(overview.kpi!, "today");
  assert.deepEqual(today.map((t) => t.key), ["gatewaySales", "commission", "codOrderValue", "orders", "unsettled"]);
  assert.equal(today[0]!.value, "Rs. 1,000");
  assert.equal(kpiTiles(overview.kpi!, "last30")[0]!.value, "Rs. 20,000");
  assert.equal(kpiTiles(overview.kpi!, "last7")[3]!.value, "21");
  assert.match(kpiTiles(overview.kpi!, "today")[2]!.hint, /2 orders/);
  for (const tile of today) assert.doesNotMatch(tile.value, /\.\d{2}\b/, "no cents");
});

test("S6-B5: the unsettled balance is shown as what is held or owed, and the rows for plans and top stores are plain text", () => {
  assert.match(kpiTiles(overview.kpi!, "today")[4]!.value, /1,200/);
  assert.deepEqual(planRows(overview.kpi!), [
    { key: "growth:active", label: "growth", status: "active", count: "3" },
    { key: "free:none", label: "free", status: "none", count: "4" },
  ]);
  assert.deepEqual(topStoreRows(overview.kpi!), [{ key: "65a000000000000000000011", name: "Zara Lawn", sales: "Rs. 50,000", href: "/orders?store=65a000000000000000000011" }]);
  assert.deepEqual(topStoreRows({ ...overview.kpi!, topStores: [{ storeId: "65a000000000000000000012", storeName: null, sales: 5 }] })[0]!.name, "Unnamed store");
});

test("SB-F1: the commission tile holds card and COD commission, with both named: COD is 0 at 0% and visible at 4%", () => {
  const at = (codCommission: number | undefined) => {
    const today = { ...overview.kpi!.periods.today, commission: 40, codCommission };
    return kpiTiles({ ...overview.kpi!, periods: { ...overview.kpi!.periods, today } }, "today")[1]!;
  };
  assert.deepEqual([at(0).value, at(0).hint], ["Rs. 40", "Card Rs. 40 · COD Rs. 0"]);
  // 4% of Rs. 2,000 of cash on delivery.
  assert.deepEqual([at(80).value, at(80).hint], ["Rs. 120", "Card Rs. 40 · COD Rs. 80"]);
  assert.deepEqual([at(undefined).value, at(undefined).hint], ["Rs. 40", "Card Rs. 40 · COD Rs. 0"], "an older seller backend");
});

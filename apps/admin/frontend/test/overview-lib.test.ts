import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatMoney } from "../lib/format";
import { ledgerRows, ledgerStatusHref, outboxRows, overviewTiles, storeRows, storeStatusHref, syncStatusHref, updatedLabel } from "../lib/overview";
import type { AdminOverview } from "../lib/contracts";

const NOW = new Date("2026-10-11T10:00:00.000Z");
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const overview: AdminOverview = {
  stores: { total: 8, byStatus: { pending: 2, active: 5, suspended: 1, archived: 0 } },
  sellers: { total: 7, newInWindow: 2, windowDays: 30 },
  ledger: {
    pending: { count: 3, orderAmount: 120000, commissionAmount: 4800 },
    settled: { count: 10, orderAmount: 900000, commissionAmount: 36000 },
  },
  outbox: { counts: { pending: 1, sent: 10, dead: 0 }, oldestPendingAt: iso(1), lastSentAt: iso(1) },
  generatedAt: NOW.toISOString(),
};

const empty: AdminOverview = {
  stores: { total: 0, byStatus: { pending: 0, active: 0, suspended: 0, archived: 0 } },
  sellers: { total: 0, newInWindow: 0, windowDays: 30 },
  ledger: { pending: { count: 0, orderAmount: 0, commissionAmount: 0 }, settled: { count: 0, orderAmount: 0, commissionAmount: 0 } },
  outbox: { counts: { pending: 0, sent: 0, dead: 0 }, oldestPendingAt: null, lastSentAt: null },
  generatedAt: NOW.toISOString(),
};

test("there are four tiles in a fixed order, each linking to its page", () => {
  const tiles = overviewTiles(overview, NOW);
  assert.deepEqual(tiles.map((tile) => tile.key), ["stores", "sellers", "commission", "sync"]);
  assert.deepEqual(tiles.map((tile) => tile.href), ["/stores", "/sellers", "/commission", "/sync"]);
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

test("the commission tile adds pending and settled commission and flags pending entries", () => {
  const commission = overviewTiles(overview, NOW)[2];
  assert.equal(commission.value, formatMoney(40800));
  assert.equal(commission.hint, formatMoney(4800) + " pending across 3 entries");
  assert.deepEqual(commission.badge, { label: "3 pending", tone: "warning" });
  const one = overviewTiles({ ...overview, ledger: { ...overview.ledger, pending: { count: 1, orderAmount: 100, commissionAmount: 4 } } }, NOW)[2];
  assert.equal(one.hint, formatMoney(4) + " pending across 1 entry");
  const none = overviewTiles(empty, NOW)[2];
  assert.equal(none.value, formatMoney(0));
  assert.equal(none.badge, null);
});

test("the sync tile follows the one health rule: healthy, backlog, then dead letters", () => {
  assert.equal(overviewTiles(overview, NOW)[3].value, "Healthy");
  assert.equal(overviewTiles(overview, NOW)[3].badge, null);
  const backlog = overviewTiles({ ...overview, outbox: { ...overview.outbox, oldestPendingAt: iso(30) } }, NOW)[3];
  assert.equal(backlog.value, "Backlog");
  const dead = overviewTiles({ ...overview, outbox: { ...overview.outbox, counts: { pending: 1, sent: 10, dead: 2 } } }, NOW)[3];
  assert.equal(dead.value, "Needs attention");
  assert.deepEqual(dead.badge, { label: "2 dead", tone: "danger" });
  assert.equal(overviewTiles(empty, NOW)[3].value, "Healthy");
});

test("each breakdown row links to its list on that status", () => {
  assert.equal(storeStatusHref("suspended"), "/stores?status=suspended");
  assert.equal(ledgerStatusHref("pending"), "/commission?status=pending");
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

test("the ledger rows show the entry count with the commission and the order value", () => {
  const rows = ledgerRows(overview);
  assert.deepEqual(rows.map((row) => [row.status, row.count]), [
    ["pending", "3 entries"],
    ["settled", "10 entries"],
  ]);
  assert.equal(rows[0].detail, formatMoney(4800) + " commission on " + formatMoney(120000));
  assert.equal(rows[1].href, "/commission?status=settled");
  assert.equal(ledgerRows(empty)[0].count, "0 entries");
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

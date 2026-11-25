import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STEP_LABELS, funnelBars, hasVisits, overallText, percentText } from "../lib/analytics-view";
import { roleCan, roleSeesMenu } from "../lib/role-access";
import { TRUNCATED_MESSAGE, isTruncated, periodRange, salesExportHref, salesFileName } from "../lib/sales-export";

// Sprint 8 (S8-B7, D-118): the analytics page and the sales report download.

const read = (path: string) => readFileSync(join(process.cwd(), ...path.split("/")), "utf8").replace(/\r\n/g, "\n");

const funnel = {
  steps: [
    { key: "visits" as const, count: 200, fromPrevious: null, fromStart: 100 },
    { key: "productViews" as const, count: 150, fromPrevious: 75, fromStart: 75 },
    { key: "addToCart" as const, count: 30, fromPrevious: 20, fromStart: 15 },
    { key: "checkoutStarts" as const, count: 12, fromPrevious: 40, fromStart: 6 },
    { key: "orders" as const, count: 7, fromPrevious: 58.3, fromStart: 3.5 },
  ],
  overall: 3.5,
};

test("the funnel bars: a label, a width of the first step and the share of the step before", () => {
  const bars = funnelBars(funnel);
  assert.deepEqual(bars.map((bar) => [bar.label, bar.width, bar.note]), [
    [STEP_LABELS.visits, 100, "Start"],
    [STEP_LABELS.productViews, 75, "75% of the step before"],
    [STEP_LABELS.addToCart, 15, "20% of the step before"],
    [STEP_LABELS.checkoutStarts, 6, "40% of the step before"],
    [STEP_LABELS.orders, 3.5, "58.3% of the step before"],
  ]);
  assert.equal(percentText(0), "0%");
  assert.equal(overallText(funnel), "3.5% of visits ended in an order");
});

test("no data is no visits; any counter makes the funnel worth showing", () => {
  const zero = { steps: funnel.steps.map((step) => ({ ...step, count: 0 })), overall: 0 };
  assert.equal(hasVisits({ traffic: [{ date: "2026-11-25", visits: 0 }], funnel: zero }), false);
  assert.equal(hasVisits({ traffic: [{ date: "2026-11-25", visits: 1 }], funnel: zero }), true);
  assert.equal(hasVisits({ traffic: [], funnel }), true);
});

test("the export address carries only known, well-formed filters", () => {
  assert.equal(salesExportHref("s1", {}), "/api/proxy/stores/s1/reports/sales");
  assert.equal(salesExportHref("s1", { from: "2026-11-01", to: "2026-11-30", status: "delivered", method: "card" }), "/api/proxy/stores/s1/reports/sales?from=2026-11-01&to=2026-11-30&status=delivered&method=card");
  assert.equal(salesExportHref("s1", { from: "", to: "soon", status: "unconfirmed", method: "bank" }), "/api/proxy/stores/s1/reports/sales");
  // 21:00 UTC on 25 November is already the 26th in Pakistan.
  assert.deepEqual(periodRange(7, new Date("2026-11-25T21:00:00.000Z")), { from: "2026-11-20", to: "2026-11-26" });
});

test("the file name, and the message when the file was cut", () => {
  assert.equal(salesFileName('attachment; filename="sales-2026-11-01-to-2026-11-30.csv"'), "sales-2026-11-01-to-2026-11-30.csv");
  assert.equal(salesFileName(null), "sales.csv");
  assert.equal(salesFileName('attachment; filename="../../x"'), "sales.csv");
  assert.equal(isTruncated(new Headers({ "x-report-truncated": "1" })), true);
  assert.equal(isTruncated(new Headers()), false);
  assert.match(TRUNCATED_MESSAGE, /10,000/);
});

test("the portal passes the download headers on", () => {
  const proxy = read("lib/proxy.ts");
  assert.match(proxy, /DOWNLOAD_HEADERS = \["x-report-rows", "x-report-row-cap", "x-report-truncated"/);
  assert.match(proxy, /for \(const name of DOWNLOAD_HEADERS\)/);
  const route = read("app/api/proxy/stores/[id]/reports/sales/route.ts");
  assert.match(route, /proxyStoreGet\(req, id, "reports\/sales"/);
});

test("owner and manager only: the page, the menu and the button", () => {
  for (const role of ["owner", "manager"]) assert.equal(roleCan(role, "analytics.read") && roleSeesMenu(role, "/analytics"), true, role);
  for (const role of ["staff", "support"]) assert.equal(roleCan(role, "analytics.read") || roleSeesMenu(role, "/analytics"), false, role);
  assert.match(read("app/(dashboard)/s/[storeId]/analytics/page.tsx"), /roleCan\(activeStore\.role, "analytics\.read"\)/);
  assert.match(read("components/dashboard/SalesExportButton.tsx"), /if \(!roleCan\(activeStore\.role, "analytics\.read"\)\) return null;/);
  const orders = read("app/(dashboard)/s/[storeId]/orders/page.tsx");
  assert.match(orders, /<SalesExportButton filters=\{\{ status: filters\.status, from: filters\.from, to: filters\.to \}\}/);
});

test("the page: a period switch, bars without a chart library for the funnel, empty and error states, and it fits a 375 px screen", () => {
  const page = read("app/(dashboard)/s/[storeId]/analytics/page.tsx");
  assert.match(page, /PERIODS\.map/);
  assert.match(page, /style=\{\{ width: `\$\{bar\.width\}%` \}\}/);
  assert.match(page, /NO_VISITS_TITLE/);
  assert.match(page, /<ErrorState message=\{errorMessage\}/);
  assert.match(page, /w-full min-w-0 flex-col/);
  assert.match(page, /grid-cols-1 gap-6 md:grid-cols-2/);
  assert.match(page, /break-words/);
  assert.doesNotMatch(page, /<table|DataTable|min-w-\[|w-\[\d{3,}px\]/);
  const button = read("components/dashboard/SalesExportButton.tsx");
  assert.match(button, /min-h-11 w-full sm:w-auto/);
  assert.doesNotMatch(read("package.json"), /chart\.js|victory|nivo|visx|apexcharts/, "no new chart library");
});

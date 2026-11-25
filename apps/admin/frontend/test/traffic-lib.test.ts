import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasTraffic, totalsText, trafficBars } from "../lib/traffic";

// Sprint 8 (S8-B7, D-118): the overview's visits and orders card.

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), ...file.split("/")), "utf8");
const traffic = { days: [{ day: "2026-11-24", visits: 50, orders: 2 }, { day: "2026-11-25", visits: 200, orders: 5 }] };

test("a bar per day against the busiest one, with totals", () => {
  assert.deepEqual(trafficBars(traffic).map((bar) => [bar.label, bar.width, bar.visits, bar.orders]), [["24 Nov", 25, 50, 2], ["25 Nov", 100, 200, 5]]);
  assert.equal(totalsText(traffic), "250 visits and 7 orders in 2 days");
});

test("nothing counted: no bars worth showing and no division by zero", () => {
  const empty = { days: [{ day: "2026-11-25", visits: 0, orders: 0 }] };
  assert.equal(hasTraffic(empty), false);
  assert.equal(trafficBars(empty)[0]!.width, 0);
  assert.equal(hasTraffic({ days: [{ day: "2026-11-25", visits: 0, orders: 1 }] }), true);
});

test("the card is on the overview, read only, and fits a 375 px screen", () => {
  assert.match(read("components/overview/overview-view.tsx"), /<TrafficCard \/>/);
  const card = read("components/overview/traffic-card.tsx");
  assert.match(card, /grid-cols-\[3\.5rem_1fr_auto\]/);
  assert.match(card, /min-w-0/);
  assert.doesNotMatch(card, /method:|<table|min-w-\[|w-\[\d{3,}px\]/);
  assert.match(read("app/api/overview/traffic/route.ts"), /proxyToBackend\(request, "\/api\/admin\/overview\/traffic"\)/);
});

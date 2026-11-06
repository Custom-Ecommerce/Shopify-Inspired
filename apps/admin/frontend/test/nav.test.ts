import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NAV_GROUPS, pageTitleFor } from "../components/dashboard/nav-config";

function pageExists(href: string): boolean {
  const rel = href === "/" ? "page.tsx" : href.slice(1) + "/page.tsx";
  return fs.existsSync(path.join(process.cwd(), "app", "(dashboard)", rel));
}

const items = NAV_GROUPS.flatMap((group) => group.items);

test("every live navigation item has its page", () => {
  for (const item of items.filter((i) => i.status === "live")) {
    assert.equal(pageExists(item.href), true, item.href + " is marked live but has no page");
  }
});

test("a soon item has no page yet: when its page is built, mark the item live", () => {
  for (const item of items.filter((i) => i.status === "soon")) {
    assert.equal(pageExists(item.href), false, item.href + " has a page but is still marked soon");
    assert.ok(item.phase, item.href + " needs a phase");
  }
});

test("navigation links are unique", () => {
  assert.equal(new Set(items.map((i) => i.href)).size, items.length);
});

test("the header title follows the navigation entry that owns the path", () => {
  assert.equal(pageTitleFor("/"), "Overview");
  assert.equal(pageTitleFor("/stores/abc"), "Stores");
  assert.equal(pageTitleFor("/unknown"), "Console");
});

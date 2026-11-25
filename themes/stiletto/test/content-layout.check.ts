/*
 * Sprint 7 verification: phone layout of pages that carry a seller's own words (V-11). A long unbroken page title must wrap in the page header and in the
 * footer's page links, and pages that are not product lists (a static page, 404, unavailable) must not say "0 Items Available". From themes/stiletto run:
 *
 *   pnpm test        (every *.check.ts through test/run-checks.mjs)
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(join(here, "..", "src", ...path.split("/")), "utf8");
const WRAP = "[overflow-wrap:anywhere]";
const classOf = (file: string, marker: RegExp) => {
  const line = source(file).split("\n").find((text) => marker.test(text));
  assert.ok(line, file + ": " + marker + " not found");
  return line;
};

// ---- the page header wraps, and its count line is shown only when a count is passed
assert.ok(classOf("components/collection/CollectionHeader.tsx", /md:col-span-6 /).includes(WRAP), "the header's text column wraps long words");
assert.match(source("components/collection/CollectionHeader.tsx"), /itemCount === undefined \? null : \(/, "no count passed: no count line");

for (const file of ["pages/content-page.tsx", "pages/not-found-page.tsx", "pages/unavailable-page.tsx"]) {
  assert.match(source(file), /<CollectionHeader /, file + " uses the header");
  assert.doesNotMatch(source(file), /itemCount/, file + " is not a product list: no item count");
}

// ---- the footer: page links, contact details and the store description wrap
for (const marker of [/data-section="store-links"/, /data-section="contact"/, /config\.brand\.description\}<\/p>/]) {
  assert.ok(classOf("components/footer/Footer.tsx", marker).includes(WRAP), "footer " + marker + " wraps long words");
}

console.log("content-layout: ok");

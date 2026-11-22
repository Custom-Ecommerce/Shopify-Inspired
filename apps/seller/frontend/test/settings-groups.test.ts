import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storeSettingsUpdateSchema } from "@markaz/contracts";
import { SETTINGS_GROUPS } from "../lib/settings-groups";

// SB-6 (verification bugs 4 and 9): the portal must let through every group the backend accepts, and the seller writes that go through
// lib/proxy.ts must not add body.store when the backend schema is strict.

test("every group of storeSettingsUpdateSchema is in the portal allowlist (and nothing else)", () => {
  const shape = (storeSettingsUpdateSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.ok(shape && typeof shape === "object", "the schema exposes its groups");
  const groups = Object.keys(shape).sort();
  assert.ok(groups.length >= 11, "the schema has at least the 11 known groups");
  assert.deepEqual([...SETTINGS_GROUPS].sort(), groups);
  for (const group of ["fraud", "returns"]) assert.ok(SETTINGS_GROUPS.includes(group), group);
});

test("the settings route uses the shared list", () => {
  const source = readFileSync(join(process.cwd(), "app", "api", "proxy", "stores", "[id]", "route.ts"), "utf8");
  assert.match(source, /SETTINGS_GROUPS/);
  assert.doesNotMatch(source, /new Set\(\["profile"/);
});

const STRICT_BACKEND_WRITES = [
  "app/api/dashboard/reviews/[id]/route.ts",
  "app/api/dashboard/reviews/[id]/reply/route.ts",
  "app/api/dashboard/discounts/route.ts",
  "app/api/dashboard/discounts/[id]/route.ts",
  "app/api/dashboard/returns/[id]/route.ts",
  // S8-B2: { token } only, and no store at all (the invite names it).
  "app/api/team/accept/route.ts",
];

test("the seller writes whose backend schema is strict do not bind body.store", () => {
  for (const file of STRICT_BACKEND_WRITES) {
    const source = readFileSync(join(process.cwd(), ...file.split("/")), "utf8");
    const writes = source.match(/proxy(Post|Patch|Put)\(/g) ?? [];
    assert.ok(writes.length >= 1, file);
    const unbound = source.match(/bindStore:\s*false/g) ?? [];
    assert.ok(unbound.length >= writes.length, file + " must opt out of bindStore for every write");
  }
});

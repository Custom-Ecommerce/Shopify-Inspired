import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanRequestSchema, updatePlanRequestSchema, archivePlanRequestSchema } from "../lib/contracts";
import {
  archiveReasonProblem,
  canArchive,
  changedPlanFields,
  conflictField,
  emptyPlanForm,
  formFromPlan,
  limitLabel,
  limitsSummary,
  parseFeatures,
  parseLimit,
  parseRupees,
  planIssuesToErrors,
  planStatus,
  priceLabel,
  toArchiveRequest,
  toCreateRequest,
  toUpdateRequest,
  validatePlanForm,
} from "../lib/plans";

// Sprint 6 EP-14.US01 (D-118): the wording, checks and requests of the plan screens. Pure functions.

const NOW = "2026-11-20T10:00:00.000Z";
const growth = {
  id: "65a0000000000000000000c1",
  key: "growth",
  name: "Growth",
  priceRs: 2500,
  interval: "month" as const,
  limits: { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true },
  features: ["Unlimited products", "Premium themes"],
  isActive: true,
  sortOrder: 2,
  stripePriceId: null,
  tier: null,
  revision: 4,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const oldPlan = { ...growth, key: null, priceRs: null, limits: null, features: [], tier: "pro" as const, stripePriceId: "price_123", revision: 0 };

const filled = { ...emptyPlanForm(), key: "scale", name: "Scale", priceRs: "5000", stores: "10", reason: "A bigger plan" };

test("money is whole rupees: digits, with or without commas, 0 allowed; fractions, signs and letters are not", () => {
  assert.equal(parseRupees("2500"), 2500);
  assert.equal(parseRupees(" 2,500 "), 2500);
  assert.equal(parseRupees("0"), 0);
  for (const bad of ["", "2500.5", "-1", "+5", "abc", "1e3", "10000001", "123456789"]) assert.equal(parseRupees(bad), null, bad);
});

test("a limit is empty for unlimited, or a whole number of the minimum or more", () => {
  assert.equal(parseLimit("", 0), null);
  assert.equal(parseLimit("  ", 1), null);
  assert.equal(parseLimit("0", 0), 0);
  assert.equal(parseLimit("10", 1), 10);
  assert.equal(parseLimit("0", 1), undefined, "a plan needs at least one store when it has a number");
  for (const bad of ["-1", "2.5", "ten", "1e2", "1000001"]) assert.equal(parseLimit(bad, 0), undefined, bad);
});

test("features are one per line, trimmed, with blank lines dropped", () => {
  assert.deepEqual(parseFeatures(" Premium themes \r\n\n  Custom domain\n"), ["Premium themes", "Custom domain"]);
  assert.deepEqual(parseFeatures(""), []);
});

test("a new plan form starts with 1 store and no seats or keys, a valid form has no errors", () => {
  const empty = emptyPlanForm();
  assert.deepEqual([empty.stores, empty.products, empty.staffSeats, empty.apiKeys, empty.customDomain, empty.premiumThemes], ["1", "", "0", "0", false, false]);
  assert.deepEqual(validatePlanForm(filled, "create"), {});
});

test("the form names each bad field with the backend's rules", () => {
  const errors = (change: Record<string, unknown>, mode: "create" | "edit" = "create") => validatePlanForm({ ...filled, ...change } as never, mode);
  assert.ok(errors({ key: "Bad Key" }).key);
  assert.equal(errors({ key: "Bad Key" }, "edit").key, undefined, "the key is not checked on an edit: it never changes");
  assert.ok(errors({ name: "x" }).name);
  assert.ok(errors({ name: "<b>x</b>" }).name);
  assert.ok(errors({ priceRs: "" }).priceRs);
  assert.ok(errors({ priceRs: "2500.5" }).priceRs);
  assert.equal(errors({ priceRs: "0" }).priceRs, undefined);
  assert.ok(errors({ stores: "0" }).stores);
  assert.equal(errors({ stores: "" }).stores, undefined, "unlimited stores");
  assert.ok(errors({ products: "-1" }).products);
  assert.ok(errors({ apiKeys: "1.5" }).apiKeys);
  assert.ok(errors({ features: Array.from({ length: 13 }, (_, i) => "F" + i).join("\n") }).features);
  assert.ok(errors({ features: "x".repeat(81) }).features);
  assert.ok(errors({ features: "<script>" }).features);
  assert.ok(errors({ sortOrder: "-1" }).sortOrder);
  assert.ok(errors({ sortOrder: "1001" }).sortOrder);
  assert.ok(errors({ stripePriceId: "prod_1" }).stripePriceId);
  assert.equal(errors({ stripePriceId: "price_1ABCdef" }).stripePriceId, undefined);
  assert.ok(errors({ reason: "  " }).reason);
  assert.ok(errors({ reason: "no" }).reason);
  assert.ok(errors({ reason: "x".repeat(301) }).reason);
});

test("the create request passes the shared contract, sends null for an empty limit, and leaves out an empty Stripe price", () => {
  const request = toCreateRequest({ ...filled, products: "", features: " One \n\n Two ", customDomain: true });
  assert.deepEqual(request.limits, { stores: 10, products: null, staffSeats: 0, apiKeys: 0, customDomain: true, premiumThemes: false });
  assert.deepEqual(request.features, ["One", "Two"]);
  assert.equal(request.priceRs, 5000);
  assert.equal("stripePriceId" in request, false);
  assert.equal(createPlanRequestSchema.safeParse(request).success, true);
  assert.equal(createPlanRequestSchema.safeParse(toCreateRequest({ ...filled, stripePriceId: " price_1ABCdef " })).success, true);
  assert.equal(toCreateRequest({ ...filled, stripePriceId: " price_1ABCdef " }).stripePriceId, "price_1ABCdef");
});

test("the edit form starts from the plan as loaded, and an old plan gets plain defaults for what it lacks", () => {
  const form = formFromPlan(growth);
  assert.deepEqual([form.key, form.name, form.priceRs, form.stores, form.products, form.staffSeats, form.customDomain, form.features, form.sortOrder, form.reason], ["growth", "Growth", "2500", "3", "", "3", true, "Unlimited products\nPremium themes", "2", ""]);
  const old = formFromPlan(oldPlan);
  assert.deepEqual([old.key, old.priceRs, old.stores, old.products, old.staffSeats, old.stripePriceId], ["", "", "1", "", "0", "price_123"]);
});

test("only a value that differs counts as a change; the same number written differently does not", () => {
  const base = formFromPlan(growth);
  assert.deepEqual(changedPlanFields(base, growth), []);
  assert.deepEqual(changedPlanFields({ ...base, priceRs: "2,500", name: " Growth " }, growth), []);
  assert.deepEqual(changedPlanFields({ ...base, priceRs: "3000" }, growth), ["priceRs"]);
  assert.deepEqual(changedPlanFields({ ...base, products: "500" }, growth), ["limits"]);
  assert.deepEqual(changedPlanFields({ ...base, premiumThemes: false }, growth), ["limits"]);
  assert.deepEqual(changedPlanFields({ ...base, features: "One" }, growth), ["features"]);
  assert.deepEqual(changedPlanFields({ ...base, stripePriceId: "price_1ABCdef", sortOrder: "5", name: "Growth+" }, growth), ["name", "sortOrder", "stripePriceId"]);
});

test("the update sends the revision, only what changed, the whole limits when one changed, and the trimmed reason; the key never goes", () => {
  const request = toUpdateRequest({ ...formFromPlan(growth), priceRs: "3000", products: "500", reason: "  Price and limits  " }, growth);
  assert.deepEqual(request, { revision: 4, priceRs: 3000, limits: { stores: 3, products: 500, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: true }, reason: "Price and limits" });
  assert.equal("key" in request, false);
  assert.equal(updatePlanRequestSchema.safeParse(request).success, true);
});

test("clearing a Stripe price sends null, and an unlimited limit stays null", () => {
  const withPrice = { ...growth, stripePriceId: "price_1ABCdef" };
  const request = toUpdateRequest({ ...formFromPlan(withPrice), stripePriceId: "  ", reason: "Manual only" }, withPrice);
  assert.deepEqual(request, { revision: 4, stripePriceId: null, reason: "Manual only" });
  assert.equal(updatePlanRequestSchema.safeParse(request).success, true);
});

test("an archive sends the revision and the trimmed reason; the reason is checked", () => {
  const request = toArchiveRequest(growth, "  Retired for a new plan ");
  assert.deepEqual(request, { revision: 4, reason: "Retired for a new plan" });
  assert.equal(archivePlanRequestSchema.safeParse(request).success, true);
  assert.ok(archiveReasonProblem(""));
  assert.ok(archiveReasonProblem("no"));
  assert.ok(archiveReasonProblem("x".repeat(301)));
  assert.equal(archiveReasonProblem("Retired"), null);
});

test("labels: unlimited, the price, the limits line and the status", () => {
  assert.equal(limitLabel(null), "Unlimited");
  assert.equal(limitLabel(1000), "1,000");
  assert.equal(priceLabel(0), "Free");
  assert.equal(priceLabel(2500), "Rs. 2,500 / month");
  assert.equal(priceLabel(null), "-");
  assert.equal(limitsSummary(growth.limits), "3 stores, Unlimited products, 3 staff, 3 API keys, custom domain, premium themes");
  assert.equal(limitsSummary({ stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false }), "1 store, 10 products, 0 staff, 0 API keys");
  assert.equal(limitsSummary(null), "Old plan: no limits set");
  assert.equal(planStatus(growth), "active");
  assert.equal(planStatus({ ...growth, isActive: false }), "archived");
  assert.equal(planStatus(oldPlan), "old");
});

test("Archive is offered for an active plan, not for an archived one and never for Free", () => {
  assert.equal(canArchive(growth), true);
  assert.equal(canArchive({ ...growth, isActive: false }), false);
  assert.equal(canArchive({ ...growth, key: "free" }), false);
  assert.equal(canArchive(oldPlan), true);
});

test("the backend's issues land on the form fields, a limit issue on its own field, and other issues are dropped", () => {
  assert.deepEqual(
    planIssuesToErrors([
      { path: "priceRs", message: "The price must be whole rupees." },
      { path: "limits.stores", message: "The store limit must be at least 1." },
      { path: "reason", message: "Give a reason." },
      { path: "body", message: "x" },
      { path: "revision", message: "y" },
    ]),
    { priceRs: "The price must be whole rupees.", stores: "The store limit must be at least 1.", reason: "Give a reason." },
  );
  assert.equal(conflictField(409, "A plan with this key already exists."), "key");
  assert.equal(conflictField(409, "The plan was changed by someone else. Reload and try again."), null);
  assert.equal(conflictField(400, "key"), null);
});

test('at 375 px the plans table keeps the price, status and actions on screen, and long audit action names wrap', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (file: string) => readFileSync(process.cwd() + '/components/' + file, 'utf8');
  const plans = read('subscriptions/subscriptions-view.tsx');
  assert.match(plans, /key: "price", header: "Price", className: "hidden sm:table-cell"/);
  assert.match(plans, /header: "Status",\s+className: "hidden sm:table-cell"/);
  assert.match(plans, /sm:hidden">\s+<span className="tabular-nums">\{priceLabel\(plan\.priceRs\)\}/, 'the hidden columns are shown under the name');
  assert.match(plans, /flex flex-col gap-2 sm:flex-row sm:flex-wrap">\s+<Button[^>]*aria-label=\{"Edit "/, 'the actions stack on a phone');
  const audit = read('audit/audit-view.tsx');
  assert.equal(audit.match(/\[overflow-wrap:anywhere\] sm:truncate/g)?.length, 2);
});

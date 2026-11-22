import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storeSettingsUpdateSchema } from "@markaz/contracts";
import { SETTINGS_GROUPS } from "../lib/settings-groups";
import {
  TAX_NOTE,
  formFromTax,
  isTaxDirty,
  labelProblem,
  parseRate,
  rateProblem,
  taxBody,
  taxExample,
  taxProblems,
  taxRowLabel,
  type TaxForm,
  type TaxRead,
} from "../lib/tax-view";

// Sprint 8 (S8-B1, D-118): the Tax tab. Pure form logic, the allowlist the portal needs to save it (the SB-6 guard), and the words.

const off: TaxRead = { enabled: false, ratePercent: 0, mode: "exclusive", label: "Tax" };
const on: TaxRead = { enabled: true, ratePercent: 17.5, mode: "inclusive", label: "GST" };

test("a store that never saved tax (and an older backend with no tax at all) shows tax off, an empty rate, exclusive and the name Tax", () => {
  const expected: TaxForm = { enabled: false, rate: "", mode: "exclusive", label: "Tax" };
  assert.deepEqual(formFromTax(off), expected);
  assert.deepEqual(formFromTax(undefined), expected);
  assert.deepEqual(formFromTax(null), expected);
});

test("the form of a saved tax shows its rate, mode and name; a rate that is kept while tax is off is still shown", () => {
  assert.deepEqual(formFromTax(on), { enabled: true, rate: "17.5", mode: "inclusive", label: "GST" });
  assert.deepEqual(formFromTax({ ...on, enabled: false }), { enabled: false, rate: "17.5", mode: "inclusive", label: "GST" });
  assert.equal(formFromTax({ enabled: true, ratePercent: 0, mode: "exclusive", label: "Tax" }).rate, "0", "a rate of 0 with tax on is a rate");
});

test("a typed rate is digits with at most 2 decimals from 0 to 100; everything else is named", () => {
  for (const [text, value] of [["17", 17], ["17.5", 17.5], ["0.01", 0.01], ["0", 0], ["100", 100], [" 17.55 ", 17.55], ["99.99", 99.99]] as const) {
    assert.equal(parseRate(text), value, text);
    assert.equal(rateProblem(text, true), null, text);
  }
  assert.match(rateProblem("17.555", true) ?? "", /2 decimals/);
  assert.match(rateProblem("-1", true) ?? "", /negative/);
  assert.match(rateProblem("100.01", true) ?? "", /at most 100/);
  assert.match(rateProblem("101", true) ?? "", /at most 100/);
  assert.match(rateProblem("abc", true) ?? "", /rate like/);
  assert.match(rateProblem("1e2", true) ?? "", /rate like/);
  assert.match(rateProblem("17,5", true) ?? "", /rate like/, "a comma is not a decimal point here");
  for (const text of ["17.555", "-1", "100.01", "abc", "", "17.", ".5"]) assert.equal(parseRate(text), null, text);
});

test("an empty rate is a problem only while tax is on", () => {
  assert.equal(rateProblem("", true), "Enter the tax rate to turn tax on.");
  assert.equal(rateProblem("", false), null);
  assert.equal(rateProblem("   ", false), null);
});

test("the name: 1 to 20 characters, no < or >", () => {
  assert.equal(labelProblem("Tax"), null);
  assert.equal(labelProblem("x".repeat(20)), null);
  assert.match(labelProblem("x".repeat(21)) ?? "", /20/);
  assert.match(labelProblem("") ?? "", /Enter a name/);
  assert.match(labelProblem("   ") ?? "", /Enter a name/);
  assert.match(labelProblem("<b>") ?? "", /cannot contain/);
});

test("the problems are named by the field the server would name, so Save is held back and the field marked", () => {
  assert.deepEqual(taxProblems(formFromTax(off)), {});
  assert.deepEqual(taxProblems({ enabled: true, rate: "", mode: "exclusive", label: "Tax" }), { "tax.ratePercent": "Enter the tax rate to turn tax on." });
  assert.deepEqual(Object.keys(taxProblems({ enabled: true, rate: "17.555", mode: "exclusive", label: "<b>" })).sort(), ["tax.label", "tax.ratePercent"]);
});

test("the save body carries only what changed; nothing changed is null; spaces alone are no change", () => {
  const saved = formFromTax(off);
  assert.equal(taxBody(saved, { ...saved }), null);
  assert.equal(isTaxDirty(saved, { ...saved, label: " Tax " }), false);
  assert.equal(isTaxDirty(saved, { ...saved, rate: "  " }), false);
  assert.deepEqual(taxBody(saved, { ...saved, enabled: true, rate: "17" }), { tax: { enabled: true, ratePercent: 17 } });
  assert.deepEqual(taxBody(saved, { ...saved, enabled: true, rate: "17", mode: "inclusive", label: " GST " }), { tax: { enabled: true, ratePercent: 17, mode: "inclusive", label: "GST" } });
  const live = formFromTax(on);
  assert.deepEqual(taxBody(live, { ...live, mode: "exclusive" }), { tax: { mode: "exclusive" } });
  assert.deepEqual(taxBody(live, { ...live, enabled: false }), { tax: { enabled: false } });
  assert.deepEqual(taxBody(live, { ...live, rate: "17.50" }), null, "the same rate typed another way is no change");
  assert.deepEqual(taxBody(live, { ...live, rate: "5" }), { tax: { ratePercent: 5 } });
});

test("turning tax back on always sends its rate, so the server never has to guess it", () => {
  const savedOff = formFromTax({ enabled: false, ratePercent: 17, mode: "exclusive", label: "Tax" });
  assert.deepEqual(taxBody(savedOff, { ...savedOff, enabled: true }), { tax: { enabled: true, ratePercent: 17 } });
});

test("every body the tab sends passes the backend schema (the contracts are the single rule)", () => {
  const saved = formFromTax(off);
  for (const next of [
    { ...saved, enabled: true, rate: "17" },
    { ...saved, enabled: true, rate: "0" },
    { ...saved, enabled: true, rate: "0.01", mode: "inclusive" as const, label: "VAT" },
    { ...saved, enabled: true, rate: "100", label: "x".repeat(20) },
  ]) {
    assert.deepEqual(taxProblems(next), {});
    const body = taxBody(saved, next)!;
    assert.equal(storeSettingsUpdateSchema.safeParse(body).success, true, JSON.stringify(body));
  }
});

test("the portal lets the tax group through, and the SB-6 guard still holds (every group of the backend schema is in the allowlist)", () => {
  assert.ok(SETTINGS_GROUPS.includes("tax"));
  const shape = (storeSettingsUpdateSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.deepEqual([...SETTINGS_GROUPS].sort(), Object.keys(shape).sort());
});

test("the settings write goes through the shared proxy and does not bind body.store (the backend schema is strict)", () => {
  const source = readFileSync(join(process.cwd(), "app", "api", "proxy", "stores", "[id]", "route.ts"), "utf8");
  assert.match(source, /bindStore:\s*false/);
  assert.match(source, /SETTINGS_GROUPS/);
});

test("the tab is in the settings view, saves through the grouped PATCH and shows the note", () => {
  const view = readFileSync(join(process.cwd(), "components", "dashboard", "settings", "StoreSettingsView.tsx"), "utf8");
  assert.match(view, /value: "tax", label: "Tax"/);
  assert.match(view, /<TaxTab /);
  const tab = readFileSync(join(process.cwd(), "components", "dashboard", "settings", "TaxTab.tsx"), "utf8");
  assert.match(tab, /TAX_NOTE/);
  assert.match(tab, /Switch/);
  assert.match(tab, /MODE_COPY/);
  assert.match(tab, /taxBody\(saved, form\)/);
  assert.match(tab, /fieldErrors\["tax\.ratePercent"\]/);
  assert.match(tab, /fieldErrors\["tax\.label"\]/);
  assert.equal(/dangerouslySetInnerHTML/.test(tab), false);
  assert.equal(TAX_NOTE, "Check your own tax rules; Markazify only calculates what you enter.");
});

test("the worked example uses the same arithmetic as the order", () => {
  assert.equal(taxExample({ enabled: true, rate: "", mode: "exclusive", label: "Tax" }), null);
  assert.equal(taxExample({ enabled: true, rate: "17", mode: "exclusive", label: "Tax" }), "Example: Rs. 1,000 of items gets Rs. 170 Tax added: Rs. 1,170 plus delivery.");
  assert.equal(
    taxExample({ enabled: true, rate: "17", mode: "inclusive", label: "GST" }),
    "Example: Rs. 1,000 of items already contains Rs. 145 GST. The total stays Rs. 1,000 plus delivery.",
  );
  assert.match(taxExample({ enabled: false, rate: "0", mode: "exclusive", label: "" }) ?? "", /Rs. 0 Tax added/);
});

test("the name of the tax line on an order: the store's name, with the rate and '(included)' when the prices already contained it", () => {
  assert.equal(taxRowLabel("Tax", "exclusive"), "Tax");
  assert.equal(taxRowLabel("Tax", "inclusive"), "Tax (included)");
  assert.equal(taxRowLabel("GST", "exclusive", 17), "GST 17%");
  assert.equal(taxRowLabel("GST", "inclusive", 17.5), "GST 17.5% (included)");
  assert.equal(taxRowLabel(null, null), "Tax");
  assert.equal(taxRowLabel("", "exclusive", 0), "Tax");
});

test("the seller order detail and the slip show the tax line only when the order has one", () => {
  const detail = readFileSync(join(process.cwd(), "app", "(dashboard)", "s", "[storeId]", "orders", "[id]", "page.tsx"), "utf8");
  assert.match(detail, /order\.taxAmount && order\.taxAmount > 0/);
  assert.match(detail, /taxRowLabel\(order\.taxLabel, order\.taxMode, order\.taxRatePercent\)/);
  assert.ok(detail.indexOf("taxRowLabel(order.taxLabel") < detail.indexOf('<Row label="Total">'), "the tax line is above the total");
  const print = readFileSync(join(process.cwd(), "app", "(dashboard)", "s", "[storeId]", "orders", "print", "page.tsx"), "utf8");
  assert.match(print, /order\.taxAmount && order\.taxAmount > 0/);
  assert.match(print, /taxRowLabel\(order\.taxLabel, order\.taxMode\)/);
});

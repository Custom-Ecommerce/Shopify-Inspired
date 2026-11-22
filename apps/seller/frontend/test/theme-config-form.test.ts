import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storeSettingsUpdateSchema } from "@markaz/contracts";
import { SETTINGS_GROUPS } from "../lib/settings-groups";
import {
  RESET_BODY,
  checkColor,
  checkLink,
  checkText,
  defaultForm,
  formFromConfig,
  formProblems,
  isConfigDirty,
  isDefaultForm,
  previewOf,
  themeConfigPatch,
  type ThemeConfigRead,
} from "../lib/theme-config-form";

// S7-B7: the Stiletto look editor: its pure form logic, the allowlist the portal needs to save it, and the guard that keeps the SB-6 rule.

const read: ThemeConfigRead = {
  primaryColor: "#111111", accentColor: "#633e2b", fontFamily: "theme", heroTitle: null, heroSubtitle: null, heroImage: null, heroCtaLabel: null, heroCtaLink: null,
  announcementText: null, announcementEnabled: true, showFeatured: true, showCategories: true, showReviews: true, showBlog: true,
};

test("the form of a settings answer, and of an older backend with no theme config, is the defaults", () => {
  assert.deepEqual(formFromConfig(read), defaultForm());
  assert.deepEqual(formFromConfig(null), defaultForm());
  assert.deepEqual(formFromConfig(undefined), defaultForm());
  assert.equal(defaultForm().primaryColor, "#111111");
  assert.equal(formFromConfig({ ...read, fontFamily: "Comic Sans" }).fontFamily, "theme", "an unknown font reads as the theme's own");
  assert.equal(isDefaultForm(defaultForm()), true);
});

test("a typed colour: # optional, 3 or 6 digits, any case, normalised; anything else is refused with words", () => {
  assert.deepEqual(checkColor("#ABC"), { ok: true, normalized: "#aabbcc" });
  assert.deepEqual(checkColor("1a2b3c"), { ok: true, normalized: "#1a2b3c" });
  assert.deepEqual(checkColor(" #FFF "), { ok: true, normalized: "#ffffff" });
  for (const bad of ["", "red", "#12", "#1234", "rgb(0,0,0)", "url(x)", "#fff;x", "#ggg"]) assert.equal(checkColor(bad).ok, false, bad);
  const refused = checkColor("red");
  assert.equal(refused.ok === false && /#1a2b3c/.test(refused.message), true);
});

test("a typed link: empty is fine, a page of the store or https is fine, javascript and the rest are refused", () => {
  assert.deepEqual(checkLink(""), { ok: true, normalized: "" });
  assert.deepEqual(checkLink(" /products "), { ok: true, normalized: "/products" });
  assert.deepEqual(checkLink("https://wa.me/923001234567"), { ok: true, normalized: "https://wa.me/923001234567" });
  for (const bad of ["javascript:alert(1)", "http://x.com", "//evil.test", "products", "/a b", "data:text/html,x"]) assert.equal(checkLink(bad).ok, false, bad);
});

test("a typed text: within its limit and without < or >", () => {
  assert.deepEqual(checkText("  Eid sale ", 80, "The title"), { ok: true, normalized: "Eid sale" });
  assert.equal(checkText("x".repeat(81), 80, "The title").ok, false);
  assert.equal(checkText("<b>x</b>", 80, "The title").ok, false);
});

test("the problems of a form are named by the field the server would name, so Save is held back and the field marked", () => {
  assert.deepEqual(formProblems(defaultForm()), {});
  const form = { ...defaultForm(), primaryColor: "red", heroTitle: "<x>", heroCtaLink: "javascript:alert(1)", announcementText: "a".repeat(121), heroSubtitle: "s".repeat(161), heroCtaLabel: "b".repeat(31), accentColor: "url(x)" };
  assert.deepEqual(Object.keys(formProblems(form)).sort(), [
    "themeConfig.accentColor", "themeConfig.announcementText", "themeConfig.heroCtaLabel", "themeConfig.heroCtaLink", "themeConfig.heroSubtitle", "themeConfig.heroTitle", "themeConfig.primaryColor",
  ]);
});

test("the save body carries only what changed: colours normalised, an empty text is null, the picture is its id, nothing changed is null", () => {
  const saved = defaultForm();
  assert.equal(themeConfigPatch(saved, defaultForm()), null);
  assert.equal(isConfigDirty(saved, { ...saved, heroTitle: "  " }), false, "spaces alone are not a change");
  const next = { ...saved, primaryColor: "#ABC", heroTitle: " Eid sale ", heroImage: { id: "65a0000000000000000c0001", url: "https://x/y.png" }, showBlog: false, fontFamily: "serif" as const };
  assert.deepEqual(themeConfigPatch(saved, next), { primaryColor: "#aabbcc", heroTitle: "Eid sale", heroImage: "65a0000000000000000c0001", showBlog: false, fontFamily: "serif" });
  const cleared = { ...next, heroTitle: "", heroImage: null };
  assert.deepEqual(themeConfigPatch(next, cleared), { heroTitle: null, heroImage: null });
  assert.deepEqual(themeConfigPatch(saved, { ...saved, accentColor: "633E2B" }), null, "the same colour typed another way is no change");
});

test("every body the editor sends passes the backend schema (the contracts are the single rule)", () => {
  const saved = defaultForm();
  const next = { ...saved, primaryColor: "ABC", heroTitle: "Eid sale", heroCtaLink: "/products", heroCtaLabel: "SHOP", announcementText: "Free delivery", fontFamily: "rounded" as const, heroImage: { id: "65a0000000000000000c0001", url: null } };
  const body = themeConfigPatch(saved, next)!;
  assert.equal(storeSettingsUpdateSchema.safeParse({ themeConfig: body }).success, true);
  assert.equal(storeSettingsUpdateSchema.safeParse(RESET_BODY).success, true, "reset is the whole group null");
  assert.deepEqual(RESET_BODY, { themeConfig: null });
});

test("the preview takes its style from validated values only and shows the theme's own words for an empty or invalid field", () => {
  const model = previewOf({ ...defaultForm(), primaryColor: "#ABC", accentColor: "url(x)", fontFamily: "serif", heroTitle: "Eid sale", heroCtaLabel: "<x>" }, "Zara");
  assert.equal(model.style["--brand-primary"], "#aabbcc");
  assert.equal(model.style["--promo-banner-button-bg"], undefined, "an invalid colour is left out");
  assert.ok(model.style["--custom-sans"]?.includes("Georgia"));
  assert.equal(model.title, "Eid sale");
  assert.equal(model.button, "SHOP NOW", "an invalid button text falls back");
  assert.equal(model.announcement, "Welcome to Zara");
  for (const value of Object.values(model.style)) assert.equal(/url\(|expression|[;{}<>]/.test(value), false, value);
  assert.equal(previewOf({ ...defaultForm(), announcementEnabled: false }, "Zara").announcement, null);
  assert.deepEqual(previewOf({ ...defaultForm(), showBlog: false, showReviews: false }, "Zara").sections.filter((s) => !s.on).map((s) => s.key), ["reviews", "blog"]);
  assert.equal(previewOf({ ...defaultForm(), heroImage: { id: "a", url: "https://x/y.png" } }, "Zara").imageUrl, "https://x/y.png");
});

test("the portal lets the themeConfig group through, and the SB-6 guard still holds (every group of the backend schema is in the allowlist)", () => {
  assert.ok(SETTINGS_GROUPS.includes("themeConfig"));
  const shape = (storeSettingsUpdateSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.deepEqual([...SETTINGS_GROUPS].sort(), Object.keys(shape).sort());
});

test("the editor and the preview build no style string and put no seller text into raw markup", () => {
  const editor = readFileSync(join(process.cwd(), "components", "dashboard", "settings", "ThemeConfigEditor.tsx"), "utf8");
  assert.equal(/dangerouslySetInnerHTML|innerHTML|cssText/.test(editor), false);
  assert.ok(editor.includes("style={preview.style as CSSProperties}"), "the preview style is the validated object");
  assert.equal(/style=\{`/.test(editor), false);
  assert.equal(/url\(/.test(editor), false, "no CSS url() is built from a typed value");
});

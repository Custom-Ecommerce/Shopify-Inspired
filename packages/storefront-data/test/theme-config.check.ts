/*
 * Sprint 7 (S7-B7): the theme contract for a store's theme config, seen from the data layer every theme uses: the style builder takes ONLY a normalised hex and a
 * whitelisted font name, the config a theme reads is validated again and defaulted, and the public schema refuses markup and unsafe links. From
 * packages/storefront-data run:
 *
 *   npx tsx test/theme-config.check.ts        (or: pnpm test, which runs every *.check.ts)
 */
import assert from "node:assert/strict";
import { STOREFRONT_THEME_CONFIG_DEFAULTS, THEME_FONT_STACKS, storefrontThemeConfigOf, themeStyleVars } from "../src/domain/theme-config";
import { storefrontThemeConfigSchema } from "@markaz/contracts/theme-config";

const HEX_OR_STACK = (value: string) => /^#[0-9a-f]{6}$/.test(value) || Object.values(THEME_FONT_STACKS).includes(value);

// ---- the style builder rejects anything that is not a normalised hex
const rejected = ["#FFF", "#fff", "#ABCDEF", "red", "rgb(1,2,3)", "url(https://evil.test/x)", "expression(alert(1))", "var(--x)", "#abcdef;", "#abcdef}", "#abcdef\n", " #abcdef", "#abcdef ", "", null, undefined, 1, {}, ["#abcdef"], "#abcdeg", "#abcde", "#abcdef0"];
for (const value of rejected) assert.deepEqual(themeStyleVars({ primaryColor: value, accentColor: value }), {}, "colour " + JSON.stringify(value));
for (const value of ["Arial", "serif;x", "url(x)", "constructor", "toString", "", null, 3]) assert.deepEqual(themeStyleVars({ fontFamily: value }), {}, "font " + JSON.stringify(value));

// ---- and what it does build is only hex values and the fixed stacks, under custom property names
for (const family of ["theme", "system", "serif", "rounded", "mono"]) {
  const vars = themeStyleVars({ primaryColor: "#0a0b0c", accentColor: "#aabbcc", fontFamily: family });
  for (const [name, value] of Object.entries(vars)) {
    assert.ok(name.startsWith("--"), name);
    assert.ok(HEX_OR_STACK(value), name + " = " + value);
  }
}
assert.equal(themeStyleVars({ fontFamily: "theme" })["--custom-sans"], undefined, "theme: the theme's own fonts stay");

// ---- what a theme reads: validated again and defaulted
assert.deepEqual(storefrontThemeConfigOf(null), STOREFRONT_THEME_CONFIG_DEFAULTS);
assert.deepEqual(storefrontThemeConfigOf({}), STOREFRONT_THEME_CONFIG_DEFAULTS, "a theme demo has none");
assert.deepEqual(storefrontThemeConfigOf({ themeConfig: "nope" }), STOREFRONT_THEME_CONFIG_DEFAULTS);
const valid = { ...STOREFRONT_THEME_CONFIG_DEFAULTS, primaryColor: "#123456", heroTitle: "Eid sale", heroCtaLink: "/products" };
assert.deepEqual(storefrontThemeConfigOf({ themeConfig: valid }), valid);
for (const bad of [{ primaryColor: "red" }, { heroTitle: "<b>x</b>" }, { heroSubtitle: "a>b" }, { heroCtaLink: "javascript:alert(1)" }, { heroCtaLink: "//evil.test" }, { heroCtaLink: "http://x.com" }, { heroTitle: "x".repeat(81) }, { fontFamily: "Arial" }, { showBlog: "yes" }]) {
  assert.deepEqual(storefrontThemeConfigOf({ themeConfig: { ...valid, ...bad } }), STOREFRONT_THEME_CONFIG_DEFAULTS, JSON.stringify(bad));
  assert.equal(storefrontThemeConfigSchema.safeParse({ ...valid, ...bad }).success, false, JSON.stringify(bad));
}

console.log("theme-config checks passed");

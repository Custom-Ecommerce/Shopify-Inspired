/*
 * Sprint 7 (S7-B7): checks for how Stiletto applies a store's theme config: colours and the font only as validated CSS variables, every seller text as a plain
 * string for a React text node, sections switched off, the announcement, the hero, and the theme demo that must look exactly as before. No test runner is
 * needed. From themes/stiletto run:
 *
 *   npx tsx test/theme-config.check.ts        (or: pnpm test, which runs every *.check.ts through test/run-checks.mjs)
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STOREFRONT_THEME_CONFIG_DEFAULTS, THEME_FONT_STACKS } from "@markaz/storefront-data";
import { applyAnnouncementConfig, applyHeroConfig, applyStoreLinks, stilettoThemeView } from "../src/content/theme-config";
import { buildStilettoContent } from "../src/content";
import { demo } from "../src/demo";

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(join(here, "..", "src", ...path.split("/")), "utf8");
const config = (over: Record<string, unknown>) => ({ themeConfig: { ...STOREFRONT_THEME_CONFIG_DEFAULTS, ...over } });

// ---- the style: only validated values become CSS variables, and only what differs from the defaults
assert.deepEqual(stilettoThemeView(null).style, {}, "no config: no style");
assert.deepEqual(stilettoThemeView({}).style, {}, "a theme demo (no config): no style");
assert.deepEqual(stilettoThemeView(config({})).style, {}, "the defaults change nothing");
assert.deepEqual(stilettoThemeView(config({ primaryColor: "#aa0000" })).style, { "--brand-primary": "#aa0000" });
assert.deepEqual(stilettoThemeView(config({ accentColor: "#00aa00" })).style, { "--promo-banner-button-bg": "#00aa00", "--nav-cart-badge-bg": "#00aa00" });
assert.deepEqual(stilettoThemeView(config({ fontFamily: "serif" })).style, { "--custom-sans": THEME_FONT_STACKS.serif, "--custom-heading": THEME_FONT_STACKS.serif });

// ---- anything that is not a normalised hex or a whitelisted font name is dropped, whole config included (the schema is applied again here)
for (const bad of ["red", "#FFF", "#fff", "url(x)", "#aa0000;background:url(x)", "expression(1)", "", 5]) {
  const view = stilettoThemeView(config({ primaryColor: bad, accentColor: bad }));
  assert.deepEqual(view.style, {}, "colour " + JSON.stringify(bad));
  assert.deepEqual(view.config, STOREFRONT_THEME_CONFIG_DEFAULTS, "a config that fails the schema is replaced by the defaults, not partly used");
}
for (const bad of ["Arial", "serif;color:red", "url(x)", "__proto__"]) assert.deepEqual(stilettoThemeView(config({ fontFamily: bad })).style, {}, "font " + bad);
assert.deepEqual(stilettoThemeView(config({ heroCtaLink: "javascript:alert(1)" })).config.heroCtaLink, null, "a link that fails the schema is dropped");
assert.deepEqual(stilettoThemeView({ themeConfig: "x" }).style, {});

// ---- the hero: a seller's words are plain strings in their own props; the theme's own title markup is left alone
const hero = { videoSrc: "v.mp4", posterImage: "p.jpg", title: "ELEVATED <br/> ESSENTIALS", subHeading: "Sub", buttonText: "SHOP NOW", buttonLink: "/products", secondaryButtonText: "MORE", secondaryButtonLink: "/collections" };
const own = applyHeroConfig(hero, stilettoThemeView(null).config);
assert.deepEqual(own, hero, "no config: the theme's own hero, untouched");
const mine = applyHeroConfig(
  hero,
  stilettoThemeView(config({ heroTitle: "Eid <b>sale</b>"/* refused by the schema */ })).config,
);
assert.equal(mine.titleText, undefined, "a title with HTML never reaches the hero (the whole config falls back)");
const good = applyHeroConfig(
  hero,
  stilettoThemeView(config({ heroTitle: "Eid sale", heroSubtitle: "Up to 30% off", heroCtaLabel: "SHOP", heroCtaLink: "/collections/eid", heroImageUrl: "https://res.cloudinary.com/x/hero.png" })).config,
);
assert.equal(good.titleText, "Eid sale");
assert.equal(good.title, hero.title, "the theme's own title markup is not replaced, only bypassed");
assert.equal(good.subHeading, "Up to 30% off");
assert.equal(good.buttonText, "SHOP");
assert.equal(good.buttonLink, "/collections/eid");
assert.equal(good.imageSrc, "https://res.cloudinary.com/x/hero.png");
assert.equal(good.secondaryButtonText, "MORE", "the second button is the theme's");

// ---- the announcement
const base = { messages: ["Welcome to Zara"], showArrows: false };
assert.deepEqual(applyAnnouncementConfig(base, stilettoThemeView(null).config), base, "no config: what the store already showed");
assert.deepEqual(applyAnnouncementConfig(base, stilettoThemeView(config({ announcementText: "Free delivery" })).config), { messages: ["Free delivery"], showArrows: false });
assert.deepEqual(applyAnnouncementConfig(base, stilettoThemeView(config({ announcementEnabled: false, announcementText: "Free delivery" })).config), { messages: [], showArrows: false }, "switched off: no bar (an empty list hides it)");

// ---- the sections and the blog link
const sections = stilettoThemeView(config({ showFeatured: false, showCategories: false, showReviews: false, showBlog: false })).sections;
assert.deepEqual(sections, { featured: false, categories: false, reviews: false, blog: false });
assert.deepEqual(stilettoThemeView(null).sections, { featured: true, categories: true, reviews: true, blog: true });
const links = [{ label: "Blog", href: "/blog" }, { label: "About", href: "/pages/about" }];
assert.deepEqual(applyStoreLinks(links, stilettoThemeView(config({ showBlog: false })).config), [{ label: "About", href: "/pages/about" }], "the Blog link goes, pages stay");
assert.deepEqual(applyStoreLinks(links, stilettoThemeView(null).config), links);

// ---- the whole content builder: a live store with a config, and the theme demo, which must be unchanged (the defaults apply)
const store = { name: "Zara", logoUrl: null, announcement: "Hello", currency: "PKR", locale: "en-PK", mode: "live" as const, description: null, bannerUrl: null };
const live = buildStilettoContent({ ...store, ...config({ heroTitle: "Eid sale", showReviews: false, announcementText: "Free delivery" }) }, [], links);
assert.equal(live.homeConfig.hero.titleText, "Eid sale");
assert.equal(live.sections.reviews, false);
assert.deepEqual(live.navConfig.announcement.messages, ["Free delivery"]);
const plain = buildStilettoContent(store, [], links);
assert.equal(plain.homeConfig.hero.titleText, undefined);
assert.deepEqual(plain.sections, { featured: true, categories: true, reviews: true, blog: true });
assert.deepEqual(plain.navConfig.announcement.messages, ["Hello"], "a store with no config keeps its own announcement");

const demoStore = demo.store as unknown as Record<string, unknown>;
assert.equal(demoStore.themeConfig, undefined, "the demo store has no config");
const demoContent = buildStilettoContent({ name: demo.store.name, logoUrl: null, announcement: null, currency: "PKR", locale: "en-PK", mode: "demo" }, [], []);
assert.deepEqual(demoContent.sections, { featured: true, categories: true, reviews: true, blog: true }, "demo: every section on");
assert.equal(demoContent.homeConfig.hero.titleText, undefined, "demo: the theme's own hero");
assert.ok(demoContent.homeConfig.hero.title.includes("ELEVATED"), "demo: the theme's own title");
assert.ok(demoContent.navConfig.announcement.messages.length > 0, "demo: the theme's own announcement bar");
assert.deepEqual(stilettoThemeView({ themeConfig: undefined }).style, {});

// ---- the wiring: a seller's title is a text node, the layout builds a style OBJECT from the validated view and never concatenates a style string
const hero_tsx = source("components/hero/Hero.tsx");
assert.ok(hero_tsx.includes("{titleText}"), "the hero renders the seller's title as a text node");
assert.equal((hero_tsx.match(/dangerouslySetInnerHTML/g) ?? []).length, 1, "the only raw markup in the hero is the theme's own title");
assert.ok(/dangerouslySetInnerHTML=\{\{ __html: title \}\}/.test(hero_tsx), "and it is `title`, never `titleText`");
assert.ok(!/dangerouslySetInnerHTML=\{\{ __html: titleText/.test(hero_tsx));
const layout_tsx = source("layout/layout.tsx");
assert.ok(layout_tsx.includes("style={view.style as React.CSSProperties}"), "the layout styles from the validated view");
assert.ok(!/style=\{`/.test(layout_tsx) && !/cssText|setAttribute\("style"/.test(layout_tsx), "no style string is built");
for (const file of ["content/theme-config.ts", "content/index.ts", "components/hero/Hero.tsx", "layout/layout.tsx"]) {
  assert.ok(!/themeConfig[^;\n]*dangerouslySetInnerHTML|dangerouslySetInnerHTML[^;\n]*(heroTitle|announcementText|heroSubtitle)/.test(source(file)), file + ": a seller text never reaches raw markup");
}

console.log("stiletto theme-config checks passed");

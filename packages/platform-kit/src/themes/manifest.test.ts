import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME_SLUG,
  NEW_STORE_THEME_SLUG,
  THEME_MANIFEST,
  THEME_OPTIONS,
  THEME_SLUGS,
  getThemeEntry,
  isSellerThemeSlug,
  isThemeSlug,
  listGalleryThemes,
  listInstalledThemes,
  listSellerThemes,
  resolveRenderTheme,
  themeSupportsCardCheckout,
} from "./manifest";
import { checkStoreSlug } from "../reservation";

describe("theme manifest", () => {
  it("contains the four Phase 1 themes (slugs stay reserved whatever their status)", () => {
    for (const slug of ["mustafa", "mola", "gani", "farooq"]) {
      assert.ok(isThemeSlug(slug), slug);
    }
  });

  it("has unique slugs, each a valid store slug", () => {
    assert.equal(new Set(THEME_SLUGS).size, THEME_SLUGS.length);
    for (const slug of THEME_SLUGS) {
      assert.deepEqual(checkStoreSlug(slug, { allowReserved: true }), { ok: true }, slug);
    }
  });

  it("makes the default an available entry", () => {
    const defaults = THEME_MANIFEST.filter((entry) => entry.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0]?.slug, DEFAULT_THEME_SLUG);
    assert.equal(getThemeEntry(DEFAULT_THEME_SLUG)?.status, "available");
  });

  it("makes Stiletto the render fallback, free, installed and selectable by sellers (D-115, D-118)", () => {
    assert.equal(DEFAULT_THEME_SLUG, "stiletto");
    assert.equal(getThemeEntry("stiletto")?.tier, "free");
    assert.equal(getThemeEntry("stiletto")?.isDefault, true);
    assert.ok(isSellerThemeSlug(DEFAULT_THEME_SLUG));
    assert.ok(listInstalledThemes().some((entry) => entry.slug === DEFAULT_THEME_SLUG));
  });

  it("makes mola and gani coming_soon with their slugs still reserved (D-115)", () => {
    for (const slug of ["mola", "gani"]) {
      assert.equal(getThemeEntry(slug)?.status, "coming_soon", slug);
      assert.ok(isThemeSlug(slug), slug);
      assert.ok(!isSellerThemeSlug(slug), slug);
      assert.ok(!listInstalledThemes().some((entry) => entry.slug === slug), slug);
    }
  });

  it("keeps Mustafa in the manifest but hidden from sellers and from the gallery (D-115)", () => {
    const mustafa = getThemeEntry("mustafa");
    assert.equal(mustafa?.hiddenFromSellers, true);
    assert.equal(mustafa?.isDefault, false);
    assert.ok(isThemeSlug("mustafa"));
    assert.ok(!isSellerThemeSlug("mustafa"));
    assert.ok(!listGalleryThemes().some((entry) => entry.slug === "mustafa"));
  });

  it("lists only Stiletto for sellers", () => {
    assert.deepEqual(listSellerThemes().map((entry) => entry.slug), ["stiletto"]);
    assert.ok(!isSellerThemeSlug("not-a-theme"));
    assert.ok(!isSellerThemeSlug(undefined));
  });

  it("shows Stiletto as available and mola, gani and farooq as coming soon only, in the gallery", () => {
    const gallery = listGalleryThemes();
    assert.equal(gallery.find((entry) => entry.slug === "stiletto")?.status, "available");
    for (const slug of ["mola", "gani", "farooq"]) assert.equal(gallery.find((entry) => entry.slug === slug)?.status, "coming_soon", slug);
    assert.deepEqual(gallery.filter((entry) => entry.status === "available").map((entry) => entry.slug), ["stiletto"]);
  });

  it("gives Stiletto a preview image (CO-81) and no other theme needs one", () => {
    assert.equal(getThemeEntry("stiletto")?.previewImage, "/theme-previews/stiletto.svg");
  });

  it("renders Stiletto for a store whose theme is mola, gani, mustafa, archived, unknown or unset, and says so (D-115)", () => {
    for (const slug of ["mola", "gani", "mustafa"]) {
      const result = resolveRenderTheme(slug);
      assert.equal(result.slug, "stiletto", slug);
      assert.equal(result.source, "default", slug);
      assert.equal(result.unavailableTheme, slug, slug);
      assert.match(result.fallbackReason ?? "", /not available yet/, slug);
    }
    for (const slug of ["perfecto", "no-such-theme"]) {
      const result = resolveRenderTheme(slug);
      assert.equal(result.slug, "stiletto", slug);
      assert.equal(result.unavailableTheme, slug, slug);
    }
    for (const unset of [null, undefined, ""]) {
      const result = resolveRenderTheme(unset);
      assert.equal(result.slug, "stiletto");
      assert.equal(result.unavailableTheme, null, "a store that never chose a theme has nothing to be told");
    }
  });

  it("renders the chosen theme when it is available and loadable, and falls back when the caller cannot load it", () => {
    assert.deepEqual(resolveRenderTheme("stiletto"), { slug: "stiletto", source: "store", unavailableTheme: null });
    const notLoadable = resolveRenderTheme("stiletto", () => false);
    assert.equal(notLoadable.slug, "stiletto");
    assert.equal(notLoadable.source, "default");
    assert.match(notLoadable.fallbackReason ?? "", /not installed/);
  });

  it("creates new stores with Stiletto, an available theme (D-059)", () => {
    assert.equal(NEW_STORE_THEME_SLUG, "stiletto");
    assert.equal(getThemeEntry(NEW_STORE_THEME_SLUG)?.status, "available");
  });

  it("keeps legacy themes selectable but out of the gallery", () => {
    const gallery = listGalleryThemes().map((entry) => entry.slug);
    assert.ok(!gallery.includes("perfecto"));
    assert.ok(!gallery.includes("minimal"));
    assert.ok(gallery.includes("stiletto"));
    assert.equal(getThemeEntry("perfecto")?.status, "archived");
    assert.ok(THEME_OPTIONS.some((option) => option.value === "perfecto"));
  });

  it("labels non-live options so editors can see their state", () => {
    const labels = Object.fromEntries(THEME_OPTIONS.map((option) => [option.value, option.label]));
    assert.equal(labels.perfecto, "Perfecto (archived)");
    assert.equal(labels.farooq, "Farooq (coming soon)");
    assert.equal(labels.mola, "Mola (coming soon)");
    assert.equal(labels.gani, "Gani (coming soon)");
    assert.equal(labels.stiletto, "Stiletto");
  });

  it("rejects non-theme values in the type guard", () => {
    assert.equal(isThemeSlug("bazaar"), false);
    assert.equal(isThemeSlug(42), false);
  });

  it("flags card checkout support: Stiletto yes, Mustafa no, anything without the flag or unknown no (SB-11)", () => {
    assert.equal(themeSupportsCardCheckout("stiletto"), true);
    assert.equal(themeSupportsCardCheckout("mustafa"), false);
    assert.equal(themeSupportsCardCheckout("mola"), false);
    assert.equal(themeSupportsCardCheckout("not-a-theme"), false);
    assert.equal(themeSupportsCardCheckout(undefined), false);
    for (const entry of THEME_MANIFEST) {
      if (!listInstalledThemes().some((installed) => installed.slug === entry.slug)) {
        assert.equal(themeSupportsCardCheckout(entry.slug), false, entry.slug);
      }
    }
  });
});

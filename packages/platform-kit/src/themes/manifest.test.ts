import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME_SLUG,
  NEW_STORE_THEME_SLUG,
  THEME_MANIFEST,
  THEME_OPTIONS,
  THEME_SLUGS,
  getThemeEntry,
  isThemeSlug,
  listGalleryThemes,
} from "./manifest";
import { checkStoreSlug } from "../reservation";

describe("theme manifest", () => {
  it("contains the four Phase 1 themes", () => {
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

  it("marks mustafa as the free default", () => {
    assert.equal(DEFAULT_THEME_SLUG, "mustafa");
    assert.equal(getThemeEntry("mustafa")?.tier, "free");
  });

  it("creates new stores with Stiletto, an available theme (D-059)", () => {
    assert.equal(NEW_STORE_THEME_SLUG, "stiletto");
    assert.equal(getThemeEntry(NEW_STORE_THEME_SLUG)?.status, "available");
  });

  it("keeps legacy themes selectable but out of the gallery", () => {
    const gallery = listGalleryThemes().map((entry) => entry.slug);
    assert.ok(!gallery.includes("perfecto"));
    assert.ok(!gallery.includes("minimal"));
    assert.ok(gallery.includes("mustafa"));
    assert.equal(getThemeEntry("perfecto")?.status, "archived");
    assert.ok(THEME_OPTIONS.some((option) => option.value === "perfecto"));
  });

  it("labels non-live options so editors can see their state", () => {
    const labels = Object.fromEntries(THEME_OPTIONS.map((option) => [option.value, option.label]));
    assert.equal(labels.perfecto, "Perfecto (archived)");
    assert.equal(labels.farooq, "Farooq (coming soon)");
    assert.equal(labels.mola, "Mola");
  });

  it("rejects non-theme values in the type guard", () => {
    assert.equal(isThemeSlug("bazaar"), false);
    assert.equal(isThemeSlug(42), false);
  });
});

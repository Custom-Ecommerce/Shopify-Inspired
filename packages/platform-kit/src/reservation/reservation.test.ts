import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVED_SUBDOMAINS,
  checkStoreSlug,
  getReservedDisposition,
  isReservedLabel,
  listReservationViolations,
} from "./index";
import { THEME_SLUGS } from "../themes/manifest";

/** The hard-coded list both backends shipped before M1, minus the theme names (derived now). */
const LEGACY_RESERVED_LABELS = [
  "theme", "www", "api", "admin", "store", "app", "mail", "ftp", "cdn", "static",
  "assets", "blog", "help", "support", "docs", "status",
] as const;

/** F9: labels the legacy list was missing. */
const F9_ADDED_LABELS = ["seller", "dashboard", "portal", "login", "shop"] as const;

describe("reserved registry invariants", () => {
  it("reports no violations", () => {
    assert.deepEqual(listReservationViolations(), []);
  });

  it("has no duplicate labels", () => {
    assert.equal(new Set(RESERVED_SUBDOMAINS).size, RESERVED_SUBDOMAINS.length);
  });

  it("is a superset of the legacy reserved list", () => {
    for (const label of LEGACY_RESERVED_LABELS) {
      assert.ok(isReservedLabel(label), `legacy label "${label}" must stay reserved`);
    }
  });

  it("reserves every label that the legacy list was missing (F9)", () => {
    for (const label of F9_ADDED_LABELS) {
      assert.ok(isReservedLabel(label), `"${label}" must be reserved`);
    }
  });

  it("reserves every theme slug from the manifest", () => {
    for (const slug of THEME_SLUGS) {
      assert.deepEqual(getReservedDisposition(slug), { kind: "theme-name", themeSlug: slug });
    }
  });
});

describe("reserved dispositions", () => {
  it("sends admin, seller, dashboard and portal to the app redirect targets", () => {
    assert.deepEqual(getReservedDisposition("admin"), { kind: "app-redirect", target: "admin" });
    assert.deepEqual(getReservedDisposition("seller"), { kind: "app-redirect", target: "seller-portal" });
    assert.deepEqual(getReservedDisposition("dashboard"), { kind: "app-redirect", target: "seller-portal" });
    assert.deepEqual(getReservedDisposition("portal"), { kind: "app-redirect", target: "seller-portal" });
  });

  it("maps www to the canonical apex and api to the api redirect", () => {
    assert.deepEqual(getReservedDisposition("www"), { kind: "canonical-apex" });
    assert.deepEqual(getReservedDisposition("api"), { kind: "app-redirect", target: "api" });
  });

  it("sends auth labels to seller auth and marketing labels to marketing", () => {
    assert.deepEqual(getReservedDisposition("login"), { kind: "seller-auth" });
    assert.deepEqual(getReservedDisposition("pricing"), { kind: "marketing" });
  });

  it("returns not-found for infrastructure, environment and impersonation labels", () => {
    for (const label of ["mail", "staging", "markaz", "stripe"]) {
      assert.deepEqual(getReservedDisposition(label), { kind: "not-found" }, label);
    }
  });

  it("returns undefined for an unreserved label", () => {
    assert.equal(getReservedDisposition("molahassan"), undefined);
  });
});

describe("checkStoreSlug", () => {
  it("accepts a well-formed unreserved slug", () => {
    assert.deepEqual(checkStoreSlug("molahassan"), { ok: true });
  });

  it("rejects slugs that are too short, too long, or malformed", () => {
    for (const slug of ["ab", "-abc", "abc-", "Abc", "a--bc", "a_bc", "a".repeat(31)]) {
      const result = checkStoreSlug(slug);
      assert.equal(result.ok, false, slug);
      if (!result.ok) assert.equal(result.reason, "format", slug);
    }
  });

  it("rejects reserved words as seller slugs", () => {
    const result = checkStoreSlug("seller");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "reserved");
  });

  it("allows a theme name only when the caller opts in (theme-demo stores)", () => {
    assert.equal(checkStoreSlug("mustafa").ok, false);
    assert.deepEqual(checkStoreSlug("mustafa", { allowReserved: true }), { ok: true });
  });
});

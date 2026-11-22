import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PAGE_TEMPLATES, PAGE_TEMPLATE_KEYS, countPlaceholders, getPageTemplate, hasPlaceholder } from "./page-templates";
import { contentToPlainText, parseContent } from "./content-markdown";

// Sprint 7 (S7-B3): the five default page templates and the placeholder rule.

describe("page templates", () => {
  it("has the five default pages, each with a lowercase slug equal to its key", () => {
    assert.deepEqual(PAGE_TEMPLATES.map((t) => t.key), [...PAGE_TEMPLATE_KEYS]);
    assert.deepEqual([...PAGE_TEMPLATE_KEYS], ["about", "contact", "shipping", "returns", "privacy"]);
    for (const t of PAGE_TEMPLATES) {
      assert.equal(t.slug, t.key);
      assert.match(t.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(t.title.length >= 3 && t.title.length <= 120, t.key);
      assert.ok(t.body.length > 50 && t.body.length <= 50000, t.key);
    }
  });

  it("every template parses to a safe tree with a heading, and none holds raw markup or an address", () => {
    for (const t of PAGE_TEMPLATES) {
      const tree = parseContent(t.body);
      assert.equal(tree[0]!.type, "heading", t.key);
      assert.ok(!/<[a-z]/i.test(t.body), t.key + " holds no markup");
      assert.ok(!/https?:\/\//i.test(t.body), t.key + " holds no address to go stale");
      assert.ok(contentToPlainText(t.body).length > 20, t.key);
    }
  });

  it("every template still needs editing: it carries at least one placeholder", () => {
    for (const t of PAGE_TEMPLATES) assert.ok(hasPlaceholder(t.body), t.key);
  });

  it("the legal templates (privacy, returns) say they are not legal advice and must be edited before publishing", () => {
    for (const key of ["privacy", "returns"] as const) {
      const t = getPageTemplate(key)!;
      assert.equal(t.legal, true);
      assert.match(t.body, /not legal advice/i);
      assert.match(t.body, /Remove this note before you publish/i);
    }
    assert.equal(getPageTemplate("about")!.legal, false);
  });

  it("looks a template up by key, and answers undefined for anything else", () => {
    assert.equal(getPageTemplate("about")!.title, "About us");
    for (const key of ["", "terms", "constructor", "__proto__", null, undefined, 5]) assert.equal(getPageTemplate(key), undefined, String(key));
  });
});

describe("placeholders", () => {
  it("are found in any case and spacing, and counted", () => {
    assert.equal(hasPlaceholder("Call [[EDIT: your number]] now"), true);
    assert.equal(hasPlaceholder("[[edit:x]]"), true);
    assert.equal(hasPlaceholder("[[ EDIT : x ]]"), true);
    assert.equal(countPlaceholders("[[EDIT: a]] and [[EDIT: b]] and [[EDIT: c]]"), 3);
    assert.equal(countPlaceholders("none"), 0);
  });

  it("are not found in ordinary text, links or non-text", () => {
    for (const value of ["", "edit this", "[EDIT: x]", "[[Edit]]", "[text](https://x.test)", "[[TODO: x]]", null, undefined, 5, {}]) assert.equal(hasPlaceholder(value), false, String(value));
    assert.equal(countPlaceholders(null), 0);
  });

  it("stay visible as plain text on the page (the tree keeps them)", () => {
    const text = contentToPlainText("Email: [[EDIT: your email address]]");
    assert.equal(text, "Email: [[EDIT: your email address]]");
  });

  it("are gone once the seller edits them", () => {
    const edited = getPageTemplate("contact")!.body.replace(/\[\[EDIT:[^\]]*\]\]/g, "0300 1234567");
    assert.equal(hasPlaceholder(edited), false);
    assert.equal(countPlaceholders(edited), 0);
  });
});

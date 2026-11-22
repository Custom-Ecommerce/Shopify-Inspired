import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MARKDOWN_MAX_CHARS,
  MAX_NODES,
  contentImageUrls,
  contentToPlainText,
  escapeHtml,
  markdownToSafeHtml,
  parseContent,
  renderSafeHtml,
  safeUrl,
  type BlockNode,
  type ContentTree,
  type InlineNode,
} from "./content-markdown";

// Sprint 7 (S7-B2, D-118): the content format. The tree is the only thing a reader renders, so these tests are about what can NEVER be in it.

/** Every node of a tree, depth first. */
function walk(tree: ContentTree): Array<BlockNode | InlineNode> {
  const out: Array<BlockNode | InlineNode> = [];
  const inline = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      if (node.type === "strong" || node.type === "em" || node.type === "link") inline(node.children);
    }
  };
  for (const block of tree) {
    out.push(block);
    if (block.type === "list") for (const item of block.items) inline(item);
    else inline(block.children);
  }
  return out;
}

const links = (tree: ContentTree): string[] => walk(tree).flatMap((n) => (n.type === "link" ? [n.href] : []));
const images = (tree: ContentTree): string[] => walk(tree).flatMap((n) => (n.type === "image" ? [n.src] : []));
const allText = (tree: ContentTree): string => walk(tree).flatMap((n) => (n.type === "text" ? [n.text] : [])).join("");

describe("blocks", () => {
  it("parses headings (as h2 to h4: the page title is the h1), paragraphs and lists", () => {
    const tree = parseContent("# Big\n## Medium\n### Small\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2. b");
    assert.deepEqual(
      tree.map((b) => (b.type === "heading" ? "h" + b.level : b.type === "list" ? (b.ordered ? "ol" : "ul") : b.type)),
      ["h2", "h3", "h4", "paragraph", "ul", "ol"],
    );
    assert.deepEqual((tree[3] as { children: InlineNode[] }).children, [{ type: "text", text: "First line second line" }]);
    assert.equal((tree[4] as { items: unknown[] }).items.length, 2);
  });

  it("does not make a heading of four hashes or of a hash without a space, and not a list of -5 or **bold**", () => {
    for (const line of ["#### four", "#nospace", "-5 degrees", "**bold** at the start"]) {
      assert.equal(parseContent(line)[0]!.type, "paragraph", line);
    }
  });

  it("returns an empty tree for anything that is not text", () => {
    for (const value of [null, undefined, 5, {}, [], ""]) assert.deepEqual(parseContent(value), []);
  });

  it("is deterministic", () => {
    const text = "# T\n\n**a** *b* [c](https://x.test) ![d](https://x.test/i.png)\n\n- x\n- y";
    assert.deepEqual(parseContent(text), parseContent(text));
  });
});

describe("inline", () => {
  it("parses bold, italics (both markers), links and images", () => {
    const [p] = parseContent("**bold** and *it* and _it2_ and [site](https://example.com/a?b=1) and ![logo](https://cdn.example.com/l.png)");
    const kinds = (p as { children: InlineNode[] }).children.map((n) => n.type);
    assert.deepEqual(kinds, ["strong", "text", "em", "text", "em", "text", "link", "text", "image"]);
    assert.deepEqual(images(parseContent("![logo](https://cdn.example.com/l.png)")), ["https://cdn.example.com/l.png"]);
  });

  it("nests bold inside italics and a link label", () => {
    const tree = parseContent("*a **b** c* and [**go**](https://example.com)");
    assert.equal(walk(tree).filter((n) => n.type === "strong").length, 2);
    assert.deepEqual(links(tree), ["https://example.com/"]);
  });

  it("keeps unbalanced and unclosed markers as plain text", () => {
    for (const text of ["**no close", "*one", "a * b * c", "snake_case_name", "2 * 3 * 4", "**a*", "[no close", "[a](https://x.test", "![x](", "]]]((("]) {
      const tree = parseContent(text);
      assert.equal(walk(tree).filter((n) => n.type !== "text" && n.type !== "paragraph").length, 0, text);
      assert.equal(allText(tree).length > 0, true, text);
    }
    assert.equal(allText(parseContent("**no close")), "**no close");
  });

  it("handles nested and crossed markers without losing text or looping", () => {
    for (const text of ["**a *b** c*", "*a **b* c**", "***a***", "****", "** **", "*_*_*_", "**[**](https://x.test)**"]) {
      const tree = parseContent(text);
      assert.ok(Array.isArray(tree), text);
      assert.ok(walk(tree).length < 50, text);
    }
  });

  it("a backslash makes a marker a plain character", () => {
    assert.equal(allText(parseContent("\\*not italic\\* and \\[not a link\\](https://x.test)")), "*not italic* and [not a link](https://x.test)");
    assert.deepEqual(links(parseContent("\\[x\\](https://x.test)")), []);
  });
});

describe("raw HTML never gets into the tree", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)" onclick="steal()">x</a>',
    '<svg onload=alert(1)>',
    "<iframe src='https://evil.test'></iframe>",
    "<style>body{display:none}</style>",
    "<!-- comment --><b>bold</b>",
    "&lt;script&gt;",
  ];

  it("keeps markup as text: no node has a tag, an attribute or a handler", () => {
    for (const attack of attacks) {
      const tree = parseContent(attack);
      for (const node of walk(tree)) {
        assert.ok(["heading", "paragraph", "list", "text", "strong", "em", "link", "image"].includes(node.type), attack);
        assert.deepEqual(Object.keys(node).filter((k) => /^on/i.test(k) || k === "html" || k === "attrs" || k === "attributes"), [], attack);
      }
      assert.deepEqual(links(tree), [], attack);
      assert.deepEqual(images(tree), [], attack);
    }
  });

  it("escapes it on output: the HTML string has no real tag from the input", () => {
    for (const attack of attacks) {
      const html = markdownToSafeHtml(attack);
      assert.ok(!/<script|<img|<svg|<iframe|<style|<a href="javascript|<!--|<b>/i.test(html), attack + " -> " + html);
      assert.ok(html.startsWith("<p>") && html.endsWith("</p>"), html);
    }
    assert.equal(markdownToSafeHtml("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("escapes quotes in text and in attributes, so nothing can break out of an attribute", () => {
    const html = markdownToSafeHtml('[x](https://example.com/?a=1&b=2) and ![a "quoted" <alt>](https://cdn.example.com/i.png) "q" \'s\'');
    assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'), html);
    assert.ok(html.includes('alt="a &quot;quoted&quot; &lt;alt&gt;"'), html);
    assert.ok(html.includes("&quot;q&quot; &#39;s&#39;"), html);
    assert.equal(escapeHtml("<>&\"'"), "&lt;&gt;&amp;&quot;&#39;");
  });

  it("a heading or list item with markup is text too", () => {
    const html = markdownToSafeHtml("# <script>x</script>\n\n- <img src=x onerror=y>");
    assert.ok(!/<script|<img/.test(html), html);
    assert.ok(html.startsWith("<h2>&lt;script&gt;"), html);
    assert.ok(html.includes("<ul><li>&lt;img src=x onerror=y&gt;</li></ul>"), html);
  });
});

describe("links: only http, https, mailto and tel", () => {
  it("keeps the allowed ones", () => {
    const tree = parseContent("[a](http://example.com) [b](https://example.com/p) [c](mailto:hi@example.com) [d](tel:+923001234567)");
    assert.deepEqual(links(tree), ["http://example.com/", "https://example.com/p", "mailto:hi@example.com", "tel:+923001234567"]);
  });

  it("drops javascript:, data:, vbscript:, file:, blob: and every case or spacing trick, and keeps the text", () => {
    const bad = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java%0ascript:alert(1)",
      "java\tscript:alert(1)",
      "&#106;avascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "data:image/svg+xml,%3Csvg%20onload=alert(1)%3E",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/x",
      "ftp://example.com/x",
      "//evil.test/x",
      "/relative/path",
      "relative.html",
      "#fragment",
      "https://user:pass@example.com/",
      "https://",
      "",
    ];
    for (const target of bad) {
      const tree = parseContent("[click me](" + target + ") end");
      assert.deepEqual(links(tree), [], target);
      const html = renderSafeHtml(tree);
      assert.ok(!/href=/i.test(html), target + " -> " + html);
      assert.ok(!/javascript:|data:|vbscript:|file:/i.test(html), target + " -> " + html);
      assert.ok(html.includes("click me"), "the text is kept: " + target);
    }
  });

  it("a link whose address has a space or a quote is not a link at all, and a link inside a link keeps only the outer address", () => {
    assert.deepEqual(links(parseContent("[a](https://example.com/a b)")), []);
    assert.deepEqual(links(parseContent('[a](https://example.com/"onmouseover="x)')), []);
    // A link never holds another link.
    for (const text of ["[outer [inner](https://in.test)](https://out.test)", "[a [b](https://in.test) c](https://out.test)"]) {
      for (const node of walk(parseContent(text))) {
        if (node.type === "link") assert.equal(walk([{ type: "paragraph", children: node.children }]).filter((n) => n.type === "link").length, 0, text);
      }
    }
    assert.deepEqual(links(parseContent("[**outer**](https://out.test)")), ["https://out.test/"]);
  });

  it("safeUrl is the same rule on its own, and never throws", () => {
    assert.equal(safeUrl("https://example.com", "link"), "https://example.com/");
    assert.equal(safeUrl("mailto:a@b.co", "image"), null);
    assert.equal(safeUrl("http://example.com/i.png", "image"), null, "an image is https only");
    assert.equal(safeUrl("https://example.com/i.png", "image"), "https://example.com/i.png");
    for (const value of ["\u0000", "https://exa mple.com", "https://example.com/ ", "x".repeat(5000), "https://" + "a".repeat(5000) + ".com"]) {
      assert.equal(safeUrl(value, "link"), null);
    }
  });
});

describe("images: only https", () => {
  it("drops http, data, javascript and relative images, keeps their description as text, never the address", () => {
    for (const target of ["http://cdn.example.com/i.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "/uploads/i.png", "ftp://x.test/i.png", "https://u:p@cdn.test/i.png"]) {
      const tree = parseContent("![A cat](" + target + ")");
      assert.deepEqual(images(tree), [], target);
      assert.ok(allText(tree).startsWith("A cat"), target);
      assert.ok(!renderSafeHtml(tree).includes("<img"), target);
    }
  });

  it("lists the images a content uses, once each, in order (the media registry reads this)", () => {
    const text = "![a](https://cdn.test/1.png)\n\ntext ![b](https://cdn.test/2.png) and ![a again](https://cdn.test/1.png)\n\n- ![c](https://cdn.test/3.png)\n- ![x](http://cdn.test/no.png)";
    assert.deepEqual(contentImageUrls(text), ["https://cdn.test/1.png", "https://cdn.test/2.png", "https://cdn.test/3.png"]);
    assert.deepEqual(contentImageUrls("no images <img src=https://cdn.test/raw.png>"), []);
    assert.deepEqual(contentImageUrls(null), []);
  });

  it("an alt text with a newline or markup cannot break the attribute", () => {
    const html = markdownToSafeHtml('![line one\nline two "x"](https://cdn.test/i.png)');
    assert.ok(!html.includes("\n"));
    assert.ok(html.includes('alt="line one line two &quot;x&quot;"'), html);
  });
});

describe("limits", () => {
  const started = (): number => Date.now();

  it("cuts the input at the character limit", () => {
    const tree = parseContent("a".repeat(MARKDOWN_MAX_CHARS + 20000));
    assert.equal(allText(tree).length, MARKDOWN_MAX_CHARS);
  });

  it("a very long input parses fast and the tree stays bounded (many paragraphs, many markers)", () => {
    const t0 = started();
    const paragraphs = parseContent("x\n\n".repeat(200000));
    assert.ok(paragraphs.length <= MAX_NODES, "node cap");
    const stars = parseContent("*a ".repeat(100000));
    const brackets = parseContent("[a](".repeat(100000));
    const open = parseContent("[".repeat(100000) + "]");
    const bold = parseContent("**a *b ".repeat(50000));
    const mixed = parseContent("[x](https://e.test) ".repeat(20000));
    for (const tree of [stars, brackets, open, bold, mixed]) assert.ok(walk(tree).filter((n) => n.type !== "text").length <= MAX_NODES + 1);
    assert.ok(Date.now() - t0 < 8000, "took " + (Date.now() - t0) + " ms");
  });

  it("a deeply nested input does not overflow the stack", () => {
    const text = "*a ".repeat(300) + "x" + "*".repeat(300) + "[".repeat(2000) + "(".repeat(2000);
    assert.doesNotThrow(() => parseContent(text));
    const nested = "**".repeat(500) + "x" + "**".repeat(500);
    assert.doesNotThrow(() => parseContent(nested));
    const labels = "[".repeat(300) + "x" + "](https://x.test)".repeat(300);
    assert.doesNotThrow(() => parseContent(labels));
  });

  it("the HTML of a pathological input still has no tag the input did not earn", () => {
    const html = markdownToSafeHtml("<script>".repeat(5000) + "[x](javascript:1)".repeat(2000));
    assert.ok(!/<script/.test(html));
    assert.ok(!/href=/.test(html));
  });
});

describe("plain text", () => {
  it("reads the words without markup", () => {
    assert.equal(contentToPlainText("# Title\n\nSome **bold** and [a link](https://x.test) and ![pic](https://x.test/p.png)\n\n- one\n- two"), "Title\n\nSome bold and a link and pic\n\none\ntwo");
    assert.equal(contentToPlainText(null), "");
  });
});

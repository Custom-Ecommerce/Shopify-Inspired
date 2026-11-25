/**
 * Sprint 7 (S7-B2, D-118): the content format of articles (and, later, static pages): PLAIN TEXT with a small Markdown subset, parsed to a SAFE TREE.
 *
 * Why here: the seller backend (which images an article uses, so the media registry can protect them), the seller dashboard (the preview) and the
 * storefront (the page a shopper reads) all need the very same rules, and a rule that differs between them is a hole. The package is pure (no I/O, no
 * environment), so all three can import it.
 *
 * The subset:
 *   block   `#`, `##`, `###` headings (rendered as h2, h3, h4: the page title is the h1), paragraphs, `-` `*` `+` bullet lists, `1.` numbered lists
 *   inline  `**bold**`, `*italic*` or `_italic_`, `[text](https://link)`, `![alt](https://image)`, a backslash escapes a punctuation mark
 *
 * Safety rules (they are the point of this file):
 *   - There is NO raw HTML. A `<script>` in the input is just text; the tree has no node that carries markup, and `renderSafeHtml` escapes every text.
 *   - A link goes only to http, https, mailto or tel. An image only to https. Anything else (javascript:, data:, vbscript:, file:, a relative path, a
 *     URL with a password in it) drops the link or image and keeps its text, never its address.
 *   - Nothing here can run for ever: the input is cut at MARKDOWN_MAX_CHARS, nesting stops at MAX_INLINE_DEPTH, the tree has at most MAX_NODES nodes, and
 *     an opening marker that has no closer is looked for once, not once per marker.
 */

export const MARKDOWN_MAX_CHARS = 50000;
export const MAX_INLINE_DEPTH = 4;
export const MAX_NODES = 5000;
const MAX_URL_LENGTH = 2000;

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "image"; src: string; alt: string };

export type BlockNode =
  | { type: "heading"; level: 2 | 3 | 4; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] };

export type ContentTree = BlockNode[];

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_PROTOCOLS: ReadonlySet<string> = new Set(["https:"]);

/** The address as the tree keeps it, or null when it is not allowed. Never throws. */
export function safeUrl(raw: string, kind: "link" | "image"): string | null {
  // No trim: an address with a space anywhere, the ends included, is not an address (the control-character rule below refuses U+0020).
  const value = raw;
  if (value === "" || value.length > MAX_URL_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f-\u009f\u2028\u2029<>"'`\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowed = kind === "image" ? IMAGE_PROTOCOLS : LINK_PROTOCOLS;
  if (!allowed.has(url.protocol)) return null;
  if ((url.protocol === "http:" || url.protocol === "https:") && (url.username !== "" || url.password !== "" || url.hostname === "")) return null;
  return url.href;
}

interface Budget {
  nodes: number;
}

const PUNCTUATION = "\\`*_{}[]()#+-.!<>~|\"'";

function pushText(out: InlineNode[], text: string): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last !== undefined && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Parses one run of inline text. `inLink` stops a link inside a link; `depth` stops deep nesting. */
function parseInline(text: string, depth: number, inLink: boolean, budget: Budget): InlineNode[] {
  const out: InlineNode[] = [];
  const n = text.length;
  // Searches that already failed from some point on cannot succeed from a later point, so each kind of failed search runs once, not once per marker.
  const failedFrom: Record<string, number> = {};
  const failed = (key: string, from: number): boolean => key in failedFrom && failedFrom[key]! <= from;
  const fail = (key: string, from: number): void => {
    if (!(key in failedFrom)) failedFrom[key] = from;
  };
  let nextBracket = -2; // cached index of the next "]" (-2: not looked for yet, -1: there is none from here on)
  let nextParen = -2; // cached index of the next ")" (-2: not looked for yet, -1: there is none from here on)
  let i = 0;
  let plain = "";
  const flush = (): void => {
    pushText(out, plain);
    plain = "";
  };

  while (i < n) {
    if (budget.nodes >= MAX_NODES) {
      plain += text.slice(i);
      break;
    }
    const ch = text[i]!;

    if (ch === "\\" && i + 1 < n && PUNCTUATION.includes(text[i + 1]!)) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    // Bold and italics: the opener is not followed by a space, the closer is not preceded by one, and the run between is not empty.
    if ((ch === "*" || ch === "_") && depth < MAX_INLINE_DEPTH) {
      const double = text[i + 1] === ch && ch === "*";
      const marker = double ? "**" : ch;
      const key = "m" + marker;
      const start = i + marker.length;
      // An underscore inside a word (snake_case) is not an opener.
      const insideWord = ch === "_" && i > 0 && /[A-Za-z0-9]/.test(text[i - 1]!);
      if (!insideWord && start < n && !/\s/.test(text[start]!) && !failed(key, start)) {
        let close = -1;
        let from = start + 1;
        while (from <= n - marker.length) {
          const found = text.indexOf(marker, from);
          if (found === -1) break;
          const lone = marker !== "*" || (text[found + 1] !== "*" && text[found - 1] !== "*");
          if (!/\s/.test(text[found - 1]!) && found > start && lone) {
            close = found;
            break;
          }
          from = found + 1;
        }
        if (close !== -1) {
          flush();
          budget.nodes += 1;
          out.push({ type: double ? "strong" : "em", children: parseInline(text.slice(start, close), depth + 1, inLink, budget) });
          i = close + marker.length;
          continue;
        }
        fail(key, start);
      }
      plain += marker;
      i += marker.length;
      continue;
    }

    // Images and links. The address is whatever sits between the parentheses, up to the first ")": no spaces, at most MAX_URL_LENGTH.
    if ((ch === "[" || (ch === "!" && text[i + 1] === "[")) && !failed("[", i)) {
      const isImage = ch === "!";
      const open = isImage ? i + 1 : i;
      if (nextBracket !== -1 && nextBracket < open) nextBracket = text.indexOf("]", open + 1);
      const closeBracket = nextBracket;
      if (closeBracket === -1) {
        fail("[", i);
      } else if (text[closeBracket + 1] === "(") {
        const from = closeBracket + 2;
        if (nextParen !== -1 && nextParen < from) nextParen = text.indexOf(")", from);
        const end = nextParen;
        const target = end !== -1 && end - from <= MAX_URL_LENGTH ? text.slice(from, end) : null;
        if (target !== null && !/\s/.test(target)) {
          const label = text.slice(open + 1, closeBracket);
          flush();
          if (isImage) {
            const src = safeUrl(target, "image");
            if (src !== null) {
              budget.nodes += 1;
              out.push({ type: "image", src, alt: label.replace(/[\r\n]+/g, " ").slice(0, 300) });
            } else {
              // An image that is not allowed leaves its description behind, never its address.
              pushText(out, label);
            }
          } else {
            const href = inLink ? null : safeUrl(target, "link");
            const inner = depth < MAX_INLINE_DEPTH ? parseInline(label, depth + 1, true, budget) : ([{ type: "text", text: label }] as InlineNode[]);
            if (href !== null && inner.length > 0) {
              budget.nodes += 1;
              out.push({ type: "link", href, children: inner });
            } else {
              // A link that is not allowed keeps its text and loses its address.
              for (const node of inner) {
                if (node.type === "text") pushText(out, node.text);
                else out.push(node);
              }
            }
          }
          i = end + 1;
          continue;
        }
      }
    }

    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;

/** Parses the content to the safe tree. Always returns a tree; never throws; the same input always gives the same tree. */
export function parseContent(source: unknown): ContentTree {
  if (typeof source !== "string") return [];
  const text = source.slice(0, MARKDOWN_MAX_CHARS).replace(/\r\n?/g, "\n");
  const budget: Budget = { nodes: 0 };
  const blocks: ContentTree = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: InlineNode[][] } | null = null;

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(" ").trim();
    paragraph = [];
    if (joined === "" || budget.nodes >= MAX_NODES) return;
    budget.nodes += 1;
    blocks.push({ type: "paragraph", children: parseInline(joined, 0, false, budget) });
  };
  const closeList = (): void => {
    if (list === null) return;
    if (list.items.length > 0) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const line of text.split("\n")) {
    if (budget.nodes >= MAX_NODES) break;
    if (line.trim() === "") {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      closeParagraph();
      closeList();
      budget.nodes += 1;
      const level = (heading[1]!.length + 1) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, children: parseInline(heading[2]!.trim(), 0, false, budget) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      closeParagraph();
      const ordered = numbered !== null;
      if (list !== null && list.ordered !== ordered) closeList();
      if (list === null) list = { ordered, items: [] };
      budget.nodes += 1;
      list.items.push(parseInline(item[1]!.trim(), 0, false, budget));
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  return blocks;
}

// ------------------------------------------------------------------------------------------------------------------------------ reading the tree

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "image") return node.alt;
      return inlineText(node.children);
    })
    .join("");
}

/** The words of the content with no markup, blocks separated by a blank line (for search, excerpts and the SEO description). */
export function contentToPlainText(source: unknown): string {
  return parseContent(source)
    .map((block) => (block.type === "list" ? block.items.map((item) => inlineText(item)).join("\n") : inlineText(block.children)))
    .join("\n\n");
}

function collectImages(nodes: InlineNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === "image") out.push(node.src);
    else if (node.type === "strong" || node.type === "em" || node.type === "link") collectImages(node.children, out);
  }
}

/** Every image address the content uses (the allowed ones only), in order, without repeats. The media registry reads this. */
export function contentImageUrls(source: unknown): string[] {
  const found: string[] = [];
  for (const block of parseContent(source)) {
    if (block.type === "list") for (const item of block.items) collectImages(item, found);
    else collectImages(block.children, found);
  }
  return [...new Set(found)];
}

// ------------------------------------------------------------------------------------------------------------------------------------- output

/** Escapes text for HTML (element content and double-quoted attributes). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineHtml(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.text);
        case "strong":
          return "<strong>" + inlineHtml(node.children) + "</strong>";
        case "em":
          return "<em>" + inlineHtml(node.children) + "</em>";
        case "link":
          return '<a href="' + escapeHtml(node.href) + '" rel="noopener noreferrer nofollow">' + inlineHtml(node.children) + "</a>";
        case "image":
          return '<img src="' + escapeHtml(node.src) + '" alt="' + escapeHtml(node.alt) + '" loading="lazy">';
      }
    })
    .join("");
}

/**
 * The tree as an HTML string, every text and attribute escaped. For places that cannot render the tree as components (an email, a feed). Components should
 * render the tree directly: React escapes text itself.
 */
export function renderSafeHtml(tree: ContentTree): string {
  return tree
    .map((block) => {
      if (block.type === "heading") return "<h" + block.level + ">" + inlineHtml(block.children) + "</h" + block.level + ">";
      if (block.type === "paragraph") return "<p>" + inlineHtml(block.children) + "</p>";
      const tag = block.ordered ? "ol" : "ul";
      return "<" + tag + ">" + block.items.map((item) => "<li>" + inlineHtml(item) + "</li>").join("") + "</" + tag + ">";
    })
    .join("");
}

/** Shortcut: parse, then render to escaped HTML. */
export function markdownToSafeHtml(source: unknown): string {
  return renderSafeHtml(parseContent(source));
}

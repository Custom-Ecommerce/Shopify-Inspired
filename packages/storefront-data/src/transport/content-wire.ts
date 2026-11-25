import { z } from "zod";
import { safeUrl } from "@markaz/platform-kit/content-markdown";
import type { BlockNode, ContentTree, InlineNode } from "@markaz/platform-kit/content-markdown";

/**
 * Sprint 7 (S7-B3): the response shapes of the blog and page routes. The content tree is checked AGAIN here, node by node, even though the seller
 * backend built it with the same parser: a link must pass the same address rule (http, https, mailto, tel) and an image must be https, and a node with a
 * type that is not in the subset, or a key that is not in its shape, does not get through (unknown keys are dropped). A storefront never renders what the
 * rules would not have produced.
 */

/** The deepest nesting a tree may have (the parser itself stops at 4 levels of inline nesting). */
const MAX_TREE_DEPTH = 8;

const WireText = z.object({ type: z.literal("text"), text: z.string().max(60000) });

const WireInline: z.ZodType<InlineNode> = z.lazy(() =>
  z.union([
    WireText,
    z.object({ type: z.literal("strong"), children: z.array(WireInline).max(2000) }),
    z.object({ type: z.literal("em"), children: z.array(WireInline).max(2000) }),
    z.object({
      type: z.literal("link"),
      href: z.string().max(2000).refine((href) => safeUrl(href, "link") !== null, "a link may only go to http, https, mailto or tel"),
      children: z.array(WireInline).max(2000),
    }),
    z.object({
      type: z.literal("image"),
      src: z.string().max(2000).refine((src) => safeUrl(src, "image") !== null, "an image must be https"),
      alt: z.string().max(300),
    }),
  ]),
) as z.ZodType<InlineNode>;

const inlineList = z.array(WireInline).max(2000);

const WireBlock: z.ZodType<BlockNode> = z.union([
  z.object({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3), z.literal(4)]), children: inlineList }),
  z.object({ type: z.literal("paragraph"), children: inlineList }),
  z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(inlineList).max(2000) }),
]) as z.ZodType<BlockNode>;

function inlineDepth(nodes: InlineNode[]): number {
  let deepest = 0;
  for (const node of nodes) {
    if (node.type === "strong" || node.type === "em" || node.type === "link") deepest = Math.max(deepest, 1 + inlineDepth(node.children));
  }
  return deepest;
}

/** How deep a tree nests, blocks included. */
export function treeDepth(tree: ContentTree): number {
  let deepest = 0;
  for (const block of tree) {
    const inner = block.type === "list" ? Math.max(0, ...block.items.map((item) => inlineDepth(item))) : inlineDepth(block.children);
    deepest = Math.max(deepest, 1 + inner);
  }
  return deepest;
}

export const WireContentTree: z.ZodType<ContentTree> = z
  .array(WireBlock)
  .max(5000)
  .refine((tree) => treeDepth(tree) <= MAX_TREE_DEPTH, "the content nests too deeply");

const isoText = z.string().min(1).nullable();

export const WireArticleSummary = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().nullable(),
  coverImageUrl: z.string().refine((url) => safeUrl(url, "image") !== null, "the cover must be https").nullable(),
  tags: z.array(z.string()).max(10),
  publishedAt: isoText,
});

export const WireArticle = WireArticleSummary.extend({
  content: WireContentTree,
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
});

export const WireArticleListEnvelope = z.object({
  data: z.array(WireArticleSummary),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(1),
  totalDocs: z.number().int().min(0),
});

export const WireArticleEnvelope = z.object({ data: WireArticle });

export const WirePageLink = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  showInFooter: z.boolean(),
  sortOrder: z.number().int().min(0),
  updatedAt: isoText,
});

export const WirePageListEnvelope = z.object({ data: z.array(WirePageLink).max(200) });

export const WirePage = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  content: WireContentTree,
  publishedAt: isoText,
  updatedAt: isoText,
});

export const WirePageEnvelope = z.object({ data: WirePage });

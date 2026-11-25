"use client";

import { createElement, type ReactNode } from "react";
import { parseContent, type InlineNode } from "@markaz/platform-kit/content-markdown";

/**
 * Sprint 7 (S7-B2, D-118): the preview of an article's text. It renders the SAFE TREE of @markaz/platform-kit/content-markdown as React elements, so every
 * text is escaped by React and there is no raw HTML anywhere (nothing is ever injected as markup). A link or an image that the parser refused is not in the tree.
 */
function Inline({ nodes }: { nodes: InlineNode[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={index}><Inline nodes={node.children} /></strong>;
      case "em":
        return <em key={index}><Inline nodes={node.children} /></em>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
            <Inline nodes={node.children} />
          </a>
        );
      case "image":
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={index} src={node.src} alt={node.alt} loading="lazy" className="my-2 max-h-80 max-w-full rounded-lg" />;
    }
  });
}

export function ContentPreview({ content }: { content: string }) {
  const tree = parseContent(content);
  if (tree.length === 0) return <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>;
  return (
    <div className="flex flex-col gap-3 break-words text-sm leading-relaxed" data-testid="content-preview">
      {tree.map((block, index) => {
        if (block.type === "heading") return createElement(`h${block.level}`, { key: index, className: "font-heading font-semibold" }, <Inline nodes={block.children} />);
        if (block.type === "paragraph") return <p key={index}><Inline nodes={block.children} /></p>;
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className={block.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
            {block.items.map((item, i) => (
              <li key={i}><Inline nodes={item} /></li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

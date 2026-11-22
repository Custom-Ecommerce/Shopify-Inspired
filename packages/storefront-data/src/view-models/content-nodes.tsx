import type { ReactNode } from "react";
import type { ContentTree, InlineNode } from "@markaz/platform-kit/content-markdown";

/**
 * Sprint 7 (S7-B3): renders the SAFE TREE of an article or a page as React elements. Every text is a React child, so React escapes it; there is no
 * dangerouslySetInnerHTML anywhere and no node that carries markup. The addresses of links and images were already checked twice (the parser, and the wire
 * schema of the transport); they are only ever put in href and src. This is a plain function (not a component with hooks), so a server page and a client
 * page can both call it, and a check can walk what it returns.
 */

export interface ContentClasses {
  h2?: string;
  h3?: string;
  h4?: string;
  paragraph?: string;
  ul?: string;
  ol?: string;
  li?: string;
  link?: string;
  image?: string;
}

function renderInline(nodes: InlineNode[], classes: ContentClasses): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={index}>{renderInline(node.children, classes)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children, classes)}</em>;
      case "link": {
        const external = node.href.startsWith("http://") || node.href.startsWith("https://");
        return (
          <a key={index} href={node.href} className={classes.link} rel="noopener noreferrer nofollow" {...(external ? { target: "_blank" } : {})}>
            {renderInline(node.children, classes)}
          </a>
        );
      }
      case "image":
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={index} src={node.src} alt={node.alt} loading="lazy" className={classes.image} />;
    }
  });
}

/** The tree as React nodes: h2 to h4 headings, paragraphs, lists, bold, italics, links and pictures. An empty tree is an empty list. */
export function renderContentTree(tree: ContentTree, classes: ContentClasses = {}): ReactNode[] {
  return tree.map((block, index) => {
    if (block.type === "heading") {
      const children = renderInline(block.children, classes);
      if (block.level === 2) return <h2 key={index} className={classes.h2}>{children}</h2>;
      if (block.level === 3) return <h3 key={index} className={classes.h3}>{children}</h3>;
      return <h4 key={index} className={classes.h4}>{children}</h4>;
    }
    if (block.type === "paragraph") return <p key={index} className={classes.paragraph}>{renderInline(block.children, classes)}</p>;
    const items = block.items.map((item, i) => <li key={i} className={classes.li}>{renderInline(item, classes)}</li>);
    return block.ordered ? <ol key={index} className={classes.ol}>{items}</ol> : <ul key={index} className={classes.ul}>{items}</ul>;
  });
}

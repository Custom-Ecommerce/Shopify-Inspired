import * as React from "react";
import { Container } from "@/components/shared/container";

export interface PageHeaderProps {
  /** Id of the h1. Each page has exactly one h1. */
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: "start" | "center";
  className?: string;
}

/**
 * Shared header for every inner marketing page: one h1, the same container,
 * the same top and bottom rhythm. The type classes are static strings on
 * purpose: never merge a type token and a text colour through cn().
 */
export function PageHeader({
  id = "page-title",
  eyebrow,
  title,
  lead,
  align = "start",
  className,
}: PageHeaderProps) {
  const centred = align === "center";

  return (
    <Container className={`pb-12 pt-12 md:pb-16 md:pt-16 ${centred ? "text-center" : ""} ${className ?? ""}`}>
      <div className={centred ? "mx-auto flex max-w-3xl flex-col items-center" : "flex max-w-3xl flex-col"}>
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
        )}
        <h1 id={id} className="mt-3 text-h1 font-heading font-semibold tracking-tight leading-[1.1] text-balance">
          {title}
        </h1>
        {lead && (
          <p
            className={
              centred
                ? "mt-5 text-lead text-muted-foreground leading-relaxed text-balance"
                : "mt-5 text-lead text-muted-foreground leading-relaxed text-pretty"
            }
          >
            {lead}
          </p>
        )}
      </div>
    </Container>
  );
}

import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

export interface SectionHeadingProps {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: "start" | "center";
  size?: "lg" | "md" | "sm";
  className?: string;
}

const TITLE_SIZE: Record<NonNullable<SectionHeadingProps["size"]>, string> = {
  lg: "text-h2",
  md: "text-h2-sm",
  sm: "text-h3",
};

export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  align = "start",
  size = "lg",
  className,
}: SectionHeadingProps) {
  return (
    <Reveal
      className={cn(
        "flex flex-col gap-3 mb-12 md:mb-16",
        align === "center" && "items-center text-center",
        className
      )}
    >
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        data-slot="section-heading"
        className={cn(
          "font-heading font-semibold tracking-tight leading-[1.12] text-balance",
          TITLE_SIZE[size]
        )}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={
            align === "center"
              ? "text-lead text-muted-foreground leading-relaxed max-w-2xl text-balance"
              : "text-lead text-muted-foreground leading-relaxed max-w-2xl text-pretty"
          }
        >
          {lead}
        </p>
      )}
    </Reveal>
  );
}

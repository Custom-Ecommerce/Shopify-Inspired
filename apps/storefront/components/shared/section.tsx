import { cn } from "@/lib/utils";
import { Container } from "./container";

interface SectionProps {
  id?: string;
  labelledBy: string;
  tone?: "default" | "muted";
  width?: "7xl" | "5xl" | "3xl";
  children: React.ReactNode;
  className?: string;
}

export function Section({ id, labelledBy, tone = "default", width = "7xl", children, className }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "py-(--section-y) md:py-(--section-y-md) border-t border-border",
        id && "scroll-mt-24",
        tone === "muted" && "bg-muted/50",
        className
      )}
    >
      <Container
        className={cn(
          width === "5xl" && "max-w-5xl",
          width === "3xl" && "max-w-3xl"
        )}
      >
        {children}
      </Container>
    </section>
  );
}

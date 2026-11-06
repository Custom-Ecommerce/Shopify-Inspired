import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * "View all" text link that closes a grid section. Plain text on purpose (not a
 * button): the cards above are the primary focus, this is the quiet exit.
 */
export function ViewAllLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center rounded-sm px-1 text-base font-medium text-foreground underline decoration-primary decoration-2 underline-offset-8",
        "transition-colors duration-(--dur-base) ease-out-expo motion-reduce:transition-none",
        "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {children}
    </Link>
  );
}

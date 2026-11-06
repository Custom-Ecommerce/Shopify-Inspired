import { cn } from "./cn";

/**
 * A busy indicator. It keeps turning under reduced motion, but more slowly, because it signals progress and
 * stopping it would hide that work is still happening.
 */
export function Spinner({ className }: { className?: string }) {
  const sized = className !== undefined && /(^|\s)size-/.test(className);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={cn(
        sized ? undefined : "size-4",
        "shrink-0 animate-spin motion-reduce:animate-[spin_3s_linear_infinite]",
        className,
      )}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

import { cn } from "@/lib/utils";

/**
 * StatusBadge: flat semantic status pill.
 *
 * Blueprint §5.2 rules:
 *  - 5 tones only (success / warning / info / destructive / neutral).
 *    Colour alone never carries meaning: every badge has a dot.
 *  - Anatomy: rounded-full pill, 8px dot, Poppins font-medium.
 *  - Background is tone/12% so it's a tint, NOT the tone colour itself
 *    (avoids contrast failures on amber/green text).
 *  - Text uses foreground colour, not the tone — the dot supplies the hue signal.
 *
 * Tone mapping follows blueprint §5.2 table exactly:
 *   success     active, verified, delivered, approved, settled, completed
 *   warning     pending, processing, requested
 *   info        shipped, draft, confirmed, dispatched
 *   destructive suspended, failed, cancelled, rejected
 *   neutral     unset, returned, refunded, unknown
 */

type StatusTone = "success" | "warning" | "info" | "destructive" | "neutral";

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  // success
  active: "success",
  verified: "success",
  delivered: "success",
  approved: "success",
  settled: "success",
  completed: "success",
  published: "success",
  in_stock: "success",
  // warning
  pending: "warning",
  processing: "warning",
  requested: "warning",
  low_stock: "warning",
  // info (blueprint §5.2: dispatched collapsed into info, see note)
  shipped: "info",
  draft: "info",
  confirmed: "info",
  dispatched: "info",
  // destructive
  suspended: "destructive",
  failed: "destructive",
  cancelled: "destructive",
  rejected: "destructive",
  out_of_stock: "destructive",
  // neutral
  unset: "neutral",
  returned: "neutral",
  refunded: "neutral",
};

/** Full static class strings so Tailwind can see them. */
const TONE_CLASSES: Record<StatusTone, { pill: string; dot: string }> = {
  success: {
    pill: "bg-success/12 text-foreground",
    dot: "bg-success",
  },
  warning: {
    pill: "bg-warning/12 text-foreground",
    dot: "bg-warning",
  },
  info: {
    pill: "bg-info/12 text-foreground",
    dot: "bg-info",
  },
  destructive: {
    pill: "bg-destructive/12 text-foreground",
    dot: "bg-destructive",
  },
  neutral: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

interface StatusBadgeProps {
  status: string;
  /** Text to show instead of the capitalised status, for statuses whose raw value is not readable (in_stock). */
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label: shownLabel, className }: StatusBadgeProps) {
  const normalized = status?.toLowerCase().trim() || "unknown";
  const tone: StatusTone = STATUS_TONE_MAP[normalized] ?? "neutral";
  const { pill, dot } = TONE_CLASSES[tone];

  // Capitalise first letter for display, preserve the rest as-is
  const label = shownLabel ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown");

  return (
    <span
      className={cn(
        // Pill anatomy (blueprint §5.2)
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-xs font-medium",
        pill,
        className
      )}
    >
      {/* 8px indicator dot — colour is never the only signal */}
      <span
        className={cn("size-2 shrink-0 rounded-full", dot)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

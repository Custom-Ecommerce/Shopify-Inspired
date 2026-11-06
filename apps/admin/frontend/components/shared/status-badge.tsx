import { Badge } from "@/components/ui/badge";
import { statusLabel, toneOf } from "@/lib/status";

const TONE_STYLES: Record<string, { pill: string; dot: string }> = {
  success: { pill: "bg-success/12 text-foreground", dot: "bg-success" },
  warning: { pill: "bg-warning/12 text-foreground", dot: "bg-warning" },
  danger: { pill: "bg-destructive/12 text-foreground", dot: "bg-destructive" },
  neutral: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = toneOf(status);
  const style = TONE_STYLES[tone] ?? TONE_STYLES.neutral;
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " + style.pill}>
      <span className={"size-2 shrink-0 rounded-full " + style.dot} aria-hidden />
      {label ?? statusLabel(status)}
    </span>
  );
}

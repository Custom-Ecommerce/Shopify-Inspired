import { CONFIRMATION_LABEL, RISK_FLAG_LABEL, readFlags, readStatus } from "@/lib/fraud-view";

/**
 * Sprint 5 EP-11 (D-107): the small marks on an order: "Needs confirmation" while the seller has not phoned yet, and one chip per
 * risk flag. Plain markup, no hooks, so the server-rendered order list and the client order page share them. Colour never carries the
 * meaning alone: every mark has its words.
 */
export function ConfirmationBadge({ status, className = "" }: { status: unknown; className?: string }) {
  const value = readStatus(status);
  if (value === "not_required") return null;
  const tone =
    value === "unconfirmed"
      ? "border-warning/40 bg-warning/15 text-foreground"
      : value === "confirmed"
        ? "border-success/40 bg-success/15 text-foreground"
        : "border-border bg-muted text-foreground";
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone} ${className}`}>{CONFIRMATION_LABEL[value]}</span>
  );
}

export function RiskFlagChips({ flags, className = "" }: { flags: unknown; className?: string }) {
  const list = readFlags(flags);
  if (list.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`} aria-label="Risk flags">
      {list.map((flag) => (
        <li key={flag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {RISK_FLAG_LABEL[flag]}
        </li>
      ))}
    </ul>
  );
}

import { cn } from "@/lib/utils";

const formatPKR = (amount: number) =>
  "Rs. " + amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const ORDERS = [
  { id: "MZ-7291", city: "Lahore", amount: 4250, payment: "COD", verified: true, dispatched: true },
  { id: "MZ-7290", city: "Karachi", amount: 12800, payment: "JazzCash", verified: true, dispatched: false },
  { id: "MZ-7289", city: "Islamabad", amount: 2100, payment: "COD", verified: false, dispatched: false },
  { id: "MZ-7288", city: "Faisalabad", amount: 8400, payment: "EasyPaisa", verified: true, dispatched: true },
] as const;

const CHIP = "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium";

export function LiveOrders({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs text-muted-foreground">Live orders</span>
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-xs text-muted-foreground">Synced</span>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {ORDERS.map((order) => (
          <li key={order.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[13px] font-medium text-foreground">#{order.id}</span>
                <span className="truncate text-xs text-muted-foreground">{order.city}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={cn(CHIP, "border border-border bg-background text-muted-foreground")}>{order.payment}</span>
                {order.verified ? (
                  <span className={cn(CHIP, "bg-success-subtle text-success-subtle-foreground")}>WhatsApp verified</span>
                ) : (
                  <span className={cn(CHIP, "bg-warning-subtle text-warning-subtle-foreground")}>Awaiting reply</span>
                )}
                {order.dispatched && (
                  <span className={cn(CHIP, "bg-info-subtle text-info-subtle-foreground")}>Dispatched</span>
                )}
              </div>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{formatPKR(order.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

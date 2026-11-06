import { cn } from "@/lib/utils";

const QUEUE = [
  { store: "Bilyan Traders", seller: "Ahmad K.", state: "approved", time: "2m ago" },
  { store: "Noor Textiles", seller: "Sarah M.", state: "pending", time: "15m ago" },
  { store: "Karachi Kicks", seller: "Usman A.", state: "approved", time: "1h ago" },
  { store: "Lahore Leather", seller: "Fatima R.", state: "approved", time: "2h ago" },
  { store: "Desi Decor", seller: "Ali B.", state: "pending", time: "2h ago" },
] as const;

/** Decorative store review queue used inside the auth proof-panel mockup. */
export function MockupReviewQueue({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-xs", className)}>
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">Review queue</span>
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-status-success" />
          </span>
          <span className="text-[9px] text-muted-foreground">LIVE</span>
        </div>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {QUEUE.map((row) => (
          <div key={row.store} className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[11px] font-medium text-foreground">{row.store}</span>
              <span className="truncate text-[10px] text-muted-foreground">
                {row.seller} &bull; {row.time}
              </span>
            </div>
            {row.state === "approved" ? (
              <span className="flex shrink-0 items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-status-success">
                <span className="size-1.5 rounded-full bg-status-success" />
                Approved
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-status-warning">
                <span className="size-1.5 rounded-full bg-status-warning" />
                Pending
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

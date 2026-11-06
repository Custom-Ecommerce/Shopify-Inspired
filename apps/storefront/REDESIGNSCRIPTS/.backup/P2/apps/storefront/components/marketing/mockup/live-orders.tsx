import { cn } from "@/lib/utils";

export function LiveOrders({ className }: { className?: string }) {
  const formatPKR = (amount: number) => "Rs. " + amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const orders = [
    { id: "ORD-7291", customer: "Ahmad K.", amount: 4250, status: "completed", time: "2m ago" },
    { id: "ORD-7290", customer: "Sarah M.", amount: 12800, status: "processing", time: "15m ago" },
    { id: "ORD-7289", customer: "Usman A.", amount: 2100, status: "completed", time: "1h ago" },
    { id: "ORD-7288", customer: "Fatima R.", amount: 8400, status: "completed", time: "2h ago" },
    { id: "ORD-7287", customer: "Ali B.", amount: 3150, status: "processing", time: "2h ago" },
  ];

  return (
    <div className={cn("flex flex-col rounded-md border border-border bg-background shadow-xs overflow-hidden", className)}>
      <div className="border-b border-border bg-muted/30 px-4 py-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Live Orders</span>
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full motion-safe:animate-[ping_1s_cubic-bezier(0,0,0.2,1)_3_forwards] rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          <span className="text-[10px] text-muted-foreground">SYNCED</span>
        </div>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-foreground">{order.customer}</span>
              <span className="text-[10px] text-muted-foreground">{order.id} &bull; {order.time}</span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[11px] font-semibold text-foreground tabular-nums">{formatPKR(order.amount)}</span>
              {order.status === "completed" ? (
                <span className="text-[9px] font-medium text-success uppercase tracking-wider flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-success" />
                  Completed
                </span>
              ) : (
                <span className="text-[9px] font-medium text-primary uppercase tracking-wider flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-primary" />
                  Processing
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

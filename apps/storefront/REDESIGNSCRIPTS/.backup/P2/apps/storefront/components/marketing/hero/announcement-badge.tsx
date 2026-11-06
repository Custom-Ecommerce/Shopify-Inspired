import { Badge } from "@/components/ui/badge";

export function AnnouncementBadge() {
  return (
    <Badge variant="secondary" className="pl-1 pr-3 py-1 gap-2 rounded-full font-medium hover:bg-secondary border border-border bg-muted/50">
      <div className="flex items-center justify-center bg-background rounded-full px-2 py-0.5 gap-1.5 shadow-xs">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 motion-safe:animate-[ping_1s_cubic-bezier(0,0,0.2,1)_3_forwards]" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span className="text-xs text-foreground font-semibold">Built for Pakistan</span>
      </div>
      <span className="hidden text-sm text-secondary-foreground sm:inline">COD, JazzCash and EasyPaisa</span>
    </Badge>
  );
}

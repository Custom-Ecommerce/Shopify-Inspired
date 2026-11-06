import { Badge } from "@/components/ui/badge";

export function AnnouncementBadge() {
  return (
    <Badge variant="outline" className="h-8 gap-3 rounded-full border-border bg-surface-1 px-3.5 text-sm font-normal text-muted-foreground">
      <span className="font-medium text-foreground">Built for Pakistan</span>
      <span aria-hidden="true" className="hidden h-3.5 w-px bg-border sm:block" />
      <span className="hidden sm:inline">COD, JazzCash and EasyPaisa</span>
    </Badge>
  );
}

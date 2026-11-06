import { cn } from "@/lib/utils";

/**
 * Neutral placeholder for a theme card or detail page when the theme has no real screenshot
 * (see content/marketing/themes.ts). A hairline wireframe, not a picture of the theme.
 */
export function ThemeDeviceStack({ id, className }: { id: string; className?: string }) {
  return (
    <div data-theme-placeholder={id} className={cn("relative mx-auto w-full max-w-sm", className)}>
      <div className="aspect-[16/10] overflow-hidden rounded-md border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="h-1.5 w-10 rounded-full bg-border-strong" />
          <div className="flex gap-1.5">
            <div className="h-1 w-5 rounded-full bg-border" />
            <div className="h-1 w-5 rounded-full bg-border" />
            <div className="h-1 w-5 rounded-full bg-border" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3">
          <div className="col-span-3 h-10 rounded-sm bg-surface-2" />
          <div className="h-12 rounded-sm bg-surface-2" />
          <div className="h-12 rounded-sm bg-surface-2" />
          <div className="h-12 rounded-sm bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/BrandMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceUser } from "@/lib/types/dashboard";

/**
 * Chrome for the workspace-level pages (`/` resolver states, `/stores`) —
 * i.e. everything that is NOT inside a store. No sidebar and no store context.
 * Server component.
 */
export function WorkspaceShell({
  user,
  children,
  className,
}: {
  user: Pick<WorkspaceUser, "name" | "email">;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-sm sm:px-6">
        <BrandMark href="/stores" />
        <div className="flex items-center gap-2">
          <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground sm:inline">
            {user.name || user.email}
          </span>
          <ThemeToggle />
          {/* `?clear=1` makes the middleware drop the session cookie. Added nativeButton={false} for Base UI. */}
          <Button variant="clay-soft" size="sm" render={<a href="/login?clear=1" />} nativeButton={false}>
            Log out
          </Button>
        </div>
      </header>
      <main className={cn("mx-auto w-full max-w-5xl flex-1 p-6 sm:p-8", className)}>{children}</main>
    </div>
  );
}
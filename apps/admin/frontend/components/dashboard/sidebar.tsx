"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/shared/brand-mark";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav-config";
import { NAV_ICONS } from "./nav-icons";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="relative flex w-full min-w-0 flex-col px-2 py-1">
          <p className="flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
          <div className="flex w-full min-w-0 flex-col gap-px">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              if (item.status === "soon") {
                return (
                  <span key={item.href} aria-disabled="true" className="flex h-9 w-full items-center gap-3 rounded-lg p-2 text-sm font-medium text-muted-foreground opacity-50">
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    <Badge variant="neutral">{item.phase}</Badge>
                  </span>
                );
              }
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 w-full items-center gap-3 overflow-hidden rounded-lg p-2 text-left text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <span className={active ? "flex size-6 shrink-0 items-center justify-center rounded-md bg-primary" : undefined}>
                    <Icon className={active ? "size-3.5 text-primary-foreground" : "size-4"} aria-hidden />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ className }: { className?: string }) {
  return (
    <aside className={cn("sticky top-0 h-svh w-64 shrink-0 flex-col p-2 text-sidebar-foreground", className)}>
      <div className="flex size-full min-h-0 flex-col rounded-lg bg-sidebar shadow-sm ring-1 ring-sidebar-border">
        <div className="flex flex-col gap-2 px-3 py-4">
          <BrandMark />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
          <SidebarNav />
        </div>
      </div>
    </aside>
  );
}

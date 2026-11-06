"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/contracts";
import { pageTitleFor } from "./nav-config";
import { SidebarNav } from "./sidebar";
import { UserMenu } from "./user-menu";

const FOCUSABLE = "a[href], button:not([disabled])";

export function Header({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const items = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    items()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const wide = window.matchMedia("(min-width: 768px)");
    const onResize = () => {
      if (wide.matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onResize);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-25 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-sm sm:px-6">
        <Button ref={triggerRef} variant="ghost" size="icon" className="-ml-1 size-7 md:hidden" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu />
        </Button>
        <div aria-hidden="true" className="h-4 w-px bg-border md:hidden" />
        <h1 className="text-sm font-medium text-foreground">{pageTitleFor(pathname)}</h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserMenu user={user} />
        </div>
      </header>
      {open ? (
        <div ref={drawerRef} className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-foreground/20 backdrop-blur-xs" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-sidebar pb-3 text-sidebar-foreground shadow-sm">
            <div className="flex items-center justify-between px-3 py-4">
              <BrandMark />
              <Button variant="ghost" size="icon" className="size-7" aria-label="Close navigation" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

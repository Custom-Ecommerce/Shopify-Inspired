"use client";

// SIGN_OUT_CHECKED: the redirect happens only after the server confirms the cookie is cleared.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/contracts";

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setPending(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("sign-out refused");
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Your session is still active. Try again.");
      setPending(false);
    }
  }

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "A";

  return (
    <div ref={ref} className="relative">
      <Button ref={triggerRef} variant="ghost" size="icon" aria-label="Account menu" aria-controls="account-panel" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials}</span>
      </Button>
      {open ? (
        <div id="account-panel" role="group" aria-label="Account" className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-sm">
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <Badge variant="secondary" className="mt-2 w-fit">
              Operator
            </Badge>
          </div>
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          <Button variant="ghost" size="sm" className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={pending} onClick={signOut}>
            <LogOut />
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  );
}

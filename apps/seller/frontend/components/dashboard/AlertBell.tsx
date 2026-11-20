"use client";

import type { SellerAlertListResponse, SellerAlertWire } from "@markaz/contracts";
import { Bell, CheckCheck, Loader2, Package, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";

/**
 * EP-07.US03.T01: the bell in the dashboard header. It asks the seller backend for the unread count every 60 seconds
 * (through the dashboard proxy, which adds the verified store) and, when opened, loads the newest five alerts. Opening an
 * alert marks it read. Mobile first: a 44 px target, and the list fits a 375 px screen.
 *
 * The numbers match SELLER_ALERT_POLL_MS and SELLER_ALERT_BELL_LIMIT in @markaz/contracts (only types are imported here,
 * so the client bundle does not carry the contracts package).
 */
const POLL_MS = 60_000;
const BELL_LIMIT = 5;

type ListState = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "ready"; alerts: SellerAlertWire[] };

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function AlertIcon({ kind }: { kind: SellerAlertWire["kind"] }) {
  if (kind === "new_order") return <ShoppingBag className="size-4 shrink-0 text-primary" aria-hidden="true" />;
  return <Package className={`size-4 shrink-0 ${kind === "out_of_stock" ? "text-destructive" : "text-amber-600"}`} aria-hidden="true" />;
}

export function AlertBell() {
  const storeId = useActiveStoreId();
  const storeFetch = useStoreFetch();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ kind: "idle" });
  const [markingAll, setMarkingAll] = useState(false);
  const mounted = useRef(true);

  const refreshCount = useCallback(async () => {
    try {
      const res = await storeFetch("/api/dashboard/alerts/unread-count", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread?: unknown };
      if (mounted.current && typeof data.unread === "number") setUnread(data.unread);
    } catch {
      // The bell is a hint: a failed poll keeps the last count and tries again next time.
    }
  }, [storeFetch]);

  const loadList = useCallback(async () => {
    setList({ kind: "loading" });
    try {
      const res = await storeFetch(`/api/dashboard/alerts?limit=${BELL_LIMIT}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as SellerAlertListResponse;
      if (!mounted.current) return;
      setList({ kind: "ready", alerts: data.docs ?? [] });
      setUnread(typeof data.unread === "number" ? data.unread : 0);
    } catch {
      if (mounted.current) setList({ kind: "error" });
    }
  }, [storeFetch]);

  useEffect(() => {
    mounted.current = true;
    void refreshCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCount();
    }, POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  async function markRead(alert: SellerAlertWire) {
    if (alert.readAt !== null) return;
    try {
      const res = await storeFetch(`/api/dashboard/alerts/${encodeURIComponent(alert.id)}/read`, { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread?: unknown };
      if (typeof data.unread === "number") setUnread(data.unread);
    } catch {
      // Opening the alert still works; it stays unread until the next try.
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const res = await storeFetch("/api/dashboard/alerts/read-all", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { unread?: unknown };
        setUnread(typeof data.unread === "number" ? data.unread : 0);
        setList((state) =>
          state.kind === "ready" ? { kind: "ready", alerts: state.alerts.map((a) => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })) } : state,
        );
      }
    } catch {
      // Nothing changed; the button can be pressed again.
    } finally {
      setMarkingAll(false);
    }
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" className="relative min-h-11 min-w-11 shrink-0 p-0" aria-label={label} />}>
        <Bell className="size-5" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" side="bottom" sideOffset={6} className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" className="min-h-9" onClick={markAllRead} disabled={markingAll || unread === 0}>
            {markingAll ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="size-4" aria-hidden="true" />}
            Mark all read
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto" aria-live="polite">
          {list.kind === "loading" && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>}
          {list.kind === "error" && (
            <div className="px-3 py-6 text-center text-sm">
              <p className="text-muted-foreground">Could not load your notifications.</p>
              <Button variant="link" size="sm" onClick={() => void loadList()}>
                Try again
              </Button>
            </div>
          )}
          {list.kind === "ready" && list.alerts.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet. New orders and low stock show up here.</p>
          )}
          {list.kind === "ready" && list.alerts.length > 0 && (
            <ul className="divide-y divide-border">
              {list.alerts.map((alert) => {
                const content = (
                  <div className="flex min-w-0 gap-2.5">
                    <AlertIcon kind={alert.kind} />
                    <div className="min-w-0 flex-1">
                      <p className={`break-words text-sm ${alert.readAt === null ? "font-semibold" : "font-normal text-muted-foreground"}`}>{alert.title}</p>
                      {alert.body !== "" && <p className="break-words text-xs text-muted-foreground">{alert.body}</p>}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(alert.createdAt)}</p>
                    </div>
                    {alert.readAt === null && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </div>
                );
                return (
                  <li key={alert.id}>
                    {alert.link ? (
                      <Link
                        href={storeHref(storeId, alert.link)}
                        className="block px-3 py-2.5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        onClick={() => {
                          void markRead(alert);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button type="button" className="block w-full px-3 py-2.5 text-left hover:bg-muted" onClick={() => void markRead(alert)}>
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

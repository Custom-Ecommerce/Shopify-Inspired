"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { Surface } from "@/components/shared/Surface";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useActiveStoreId, useStoreHref } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import type { StoreReadiness } from "@markaz/contracts/store-settings";

/** Where each readiness item is fixed. Settings tabs are /store?tab=<tab>; the rest are their own pages. */
export function readinessHref(tab: string, href: (path?: string) => string): string {
  if (tab === "products") return href("/products/new");
  if (tab === "account") return href("/account");
  if (tab === "inventory") return href("/inventory");
  return href("/store?tab=" + encodeURIComponent(tab));
}

type Chip = { label: string; tone: "warning" | "success" | "neutral" };

/** The status chip: a pending store is "Not live yet", or "Waiting for approval" once the owner asked. */
export function statusChip(status: string, waiting: boolean): Chip {
  if (status === "active") return { label: "Live", tone: "success" };
  if (status === "pending") return waiting ? { label: "Waiting for approval", tone: "warning" } : { label: "Not live yet", tone: "neutral" };
  return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: "neutral" };
}

const CHIP_TONE: Record<Chip["tone"], string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-foreground",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Sprint 4 EP-04.US06 (D-094): the setup card on the dashboard. Progress and items come from GET .../readiness, each item
 * links to the tab or page that fixes it, and "Go live" asks the server (which refuses a store that is not ready). The card
 * is not shown once the store is live.
 */
export function OnboardingChecklist() {
  const storeId = useActiveStoreId();
  const href = useStoreHref();
  const storeFetch = useStoreFetch();
  const [readiness, setReadiness] = useState<StoreReadiness | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [resend, setResend] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}/readiness`, { cache: "no-store" });
      if (!res.ok) return;
      setReadiness((await res.json()) as StoreReadiness);
    } catch {
      // The card is a helper: when it cannot load, the dashboard simply goes without it.
    }
  }, [storeFetch, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (readiness === null || readiness.status === "active") return null;

  const items = readiness.items;
  const done = items.filter((item) => item.ok).length;
  const chip = statusChip(readiness.status, waiting);

  async function goLive() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}/go-live`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { status?: string; waitingForApproval?: boolean; message?: string; error?: string } | null;
      if (!res.ok) {
        setNotice({ error: true, text: data?.error ?? "Your store could not go live." });
        await load();
        return;
      }
      if (data?.waitingForApproval) setWaiting(true);
      setNotice({ error: false, text: data?.message ?? "Done." });
      await load();
    } catch {
      setNotice({ error: true, text: "Could not reach the server. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function resendLink() {
    setResend("Sending…");
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      setResend(res.ok ? "Sent. Check your inbox." : res.status === 429 ? "You asked a few times already. Try again in an hour." : "Could not send the link. Try again.");
    } catch {
      setResend("Could not reach the server. Try again.");
    }
  }

  return (
    <Surface variant="clay" level={2} radius="2xl" className="border-l-4 border-l-primary p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold text-foreground sm:text-lg">Get your store ready</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {done} of {items.length} done. Finish the steps, then go live.
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", CHIP_TONE[chip.tone])}>{chip.label}</span>
      </div>

      <Progress value={items.length === 0 ? 0 : (done / items.length) * 100} className="mb-5 h-2" />

      <ul className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.key} className="flex items-center gap-3">
            <span
              className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium", item.ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}
              aria-hidden="true"
            >
              {item.ok ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm", item.ok ? "text-muted-foreground line-through" : "font-medium text-foreground")}>{item.label}</p>
              {item.key === "email" && !item.ok && resend ? <p className="text-xs text-muted-foreground">{resend}</p> : null}
            </div>
            {!item.ok ? (
              item.key === "email" ? (
                <Button size="sm" variant="clay-soft" className="min-h-9 shrink-0" onClick={() => void resendLink()}>
                  Send link
                </Button>
              ) : (
                <Button size="sm" variant={index === 0 ? "clay" : "clay-soft"} render={<Link href={readinessHref(item.tab, href)} />} className="min-h-9 shrink-0">
                  Fix this
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>

      {readiness.warnings && readiness.warnings.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1">
          {readiness.warnings.map((warning) => (
            <li key={warning.key} role="status" className="rounded-lg bg-warning/15 px-3 py-2 text-sm text-foreground">
              {warning.label}{" "}
              <Link href={readinessHref(warning.tab, href)} className="font-medium underline">
                Add stock
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {notice ? (
        <p role={notice.error ? "alert" : "status"} className={cn("mt-4 text-sm", notice.error ? "text-destructive" : "text-foreground")}>
          {notice.text}
        </p>
      ) : null}

      <div className="mt-5">
        <Button className="min-h-11 w-full sm:w-auto" disabled={busy || !readiness.ready || waiting} aria-busy={busy} onClick={() => void goLive()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {waiting ? "Waiting for approval" : "Go live"}
        </Button>
        {!readiness.ready ? <p className="mt-2 text-xs text-muted-foreground">Finish every step above to go live.</p> : null}
      </div>
    </Surface>
  );
}

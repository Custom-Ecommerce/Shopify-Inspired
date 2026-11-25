"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { FormAlert } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";
import { useActiveStoreId, useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { roleCan } from "@/lib/role-access";
import { EXPORT_HELP, TRUNCATED_MESSAGE, isTruncated, salesExportHref, salesFileName, type SalesExportFilters } from "@/lib/sales-export";

/**
 * Sprint 8 (S8-B7, D-118): downloads the sales report with the filters of the page it sits on. Shown only to a role with analytics.read (the owner and a
 * manager); the server refuses anyone else.
 */
export function SalesExportButton({ filters, note }: { filters: SalesExportFilters; note?: string }) {
  const storeId = useActiveStoreId();
  const { activeStore } = useDashboard();
  const storeFetch = useStoreFetch();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  if (!roleCan(activeStore.role, "analytics.read")) return null;

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await storeFetch(salesExportHref(storeId, filters), { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage({ tone: "error", text: body?.error ?? "The report could not be made." });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = salesFileName(res.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (isTruncated(res.headers)) setMessage({ tone: "error", text: TRUNCATED_MESSAGE });
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:items-end">
      <Button type="button" variant="clay-soft" className="min-h-11 w-full sm:w-auto" onClick={() => void download()} disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
        Export sales CSV
      </Button>
      <p className="text-xs text-muted-foreground">{note ?? EXPORT_HELP}</p>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { DashboardOrderDetail } from "@markaz/contracts";
import { MessageCircle, Phone } from "lucide-react";
import { whatsappLink } from "@markaz/notifications/whatsapp";
import { ConfirmationBadge, RiskFlagChips } from "@/components/dashboard/orders/ConfirmationBits";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useDashboard } from "@/lib/dashboard-context";
import {
  CONFIRMATION_NOTE_MAX,
  LOG_RESULT_LABEL,
  RESULT_COPY,
  RISK_FLAG_LABEL,
  RISK_FLAG_WHY,
  confirmationErrorText,
  confirmationMessage,
  confirmationNoteProblem,
  readFlags,
  readStatus,
  telHref,
  type ConfirmationResultValue,
} from "@/lib/fraud-view";
import { formatRs } from "@/lib/format";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";

const when = (iso: string): string =>
  new Date(iso).toLocaleString("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });

/**
 * Sprint 5 EP-11.US01.T05 (D-107): the phone confirmation of a cash on delivery order. While the order is unconfirmed it shows why it was
 * flagged, a Call link (tel:), a WhatsApp link (wa.me with a bilingual message the seller sends from their own phone) and the three
 * result buttons with a note. A cancel asks first and goes through the normal cancel path, so stock goes back once. After any answer
 * the order is read again from the server (no optimistic update). Mobile first: full-width 44 px buttons, one column.
 */
export function ConfirmationPanel({ storeId, order, onChanged }: { storeId: string; order: DashboardOrderDetail; onChanged: () => Promise<void> }) {
  const { activeStore } = useDashboard();
  const storeFetch = useStoreFetch();
  const status = readStatus(order.confirmationStatus);
  const flags = readFlags(order.riskFlags);
  const log = order.confirmationLog ?? [];
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ConfirmationResultValue | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (status === "not_required" && flags.length === 0 && log.length === 0) return null;

  const waiting = status === "unconfirmed" && order.status !== "cancelled";
  // D-109: an unreachable decision is not final: the seller can call again and decide (confirmed and cancelled are final).
  const canDecide = (status === "unconfirmed" || status === "unreachable") && order.status !== "cancelled";
  const problem = confirmationNoteProblem(note);
  const tel = telHref(order.phone);
  const wa = whatsappLink(
    order.customerWhatsapp || order.phone,
    confirmationMessage({ storeName: activeStore.name, customerName: order.customerName, orderNumber: order.orderId, total: formatRs(order.total) }),
  );

  async function decide(result: ConfirmationResultValue): Promise<void> {
    if (problem !== null) {
      setMessage(problem);
      return;
    }
    setBusy(result);
    setMessage(null);
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(order.id)}/confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, ...(note.trim() === "" ? {} : { note: note.trim() }) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { code?: unknown } | null;
        setMessage(confirmationErrorText(res.status, typeof data?.code === "string" ? data.code : null));
      } else {
        setNote("");
      }
      await onChanged();
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
      setCancelOpen(false);
    }
  }

  return (
    <Card data-slot="confirmation-panel">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Phone confirmation <ConfirmationBadge status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {flags.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{waiting ? "Why this order needs a call" : "Flagged at checkout"}</p>
            <RiskFlagChips flags={flags} />
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {flags.map((flag) => (
                <li key={flag}>
                  <span className="font-medium text-foreground">{RISK_FLAG_LABEL[flag]}:</span> {RISK_FLAG_WHY[flag]}
                </li>
              ))}
            </ul>
          </div>
        ) : waiting ? (
          <p className="text-muted-foreground">Your store asks for a phone confirmation on every cash on delivery order.</p>
        ) : null}

        {canDecide ? (
          <>
            <p className="text-muted-foreground">
              {waiting
                ? "You cannot dispatch this order until you have spoken to the customer. Call or message them, then record what happened."
                : "You could not reach this customer. Try again whenever you like and record what happened; you can also dispatch or cancel the order."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {tel !== null ? (
                <a href={tel} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-muted sm:w-auto">
                  <Phone className="size-4" aria-hidden="true" /> Call customer
                </a>
              ) : null}
              {wa !== null ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 sm:w-auto"
                >
                  <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp confirmation
                </a>
              ) : null}
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-medium">
                Note <span className="font-normal text-muted-foreground">(optional, only you see it)</span>
              </span>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={CONFIRMATION_NOTE_MAX + 50} disabled={busy !== null} rows={2} />
              <span className={"text-xs tabular-nums " + (note.length > CONFIRMATION_NOTE_MAX ? "font-medium text-destructive" : "text-muted-foreground")}>
                {note.length}/{CONFIRMATION_NOTE_MAX}
              </span>
            </label>
            {message ? (
              <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/8 p-3">
                {message}
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button variant="clay" className="h-11 w-full sm:w-auto" disabled={busy !== null || problem !== null} onClick={() => void decide("confirmed")}>
                {busy === "confirmed" ? "Saving…" : RESULT_COPY.confirmed.button}
              </Button>
              <Button variant="clay-soft" className="h-11 w-full sm:w-auto" disabled={busy !== null || problem !== null} onClick={() => void decide("unreachable")}>
                {busy === "unreachable" ? "Saving…" : RESULT_COPY.unreachable.button}
              </Button>
              <Button variant="outline" className="h-11 w-full sm:w-auto" disabled={busy !== null || problem !== null} onClick={() => setCancelOpen(true)}>
                {RESULT_COPY.cancel.button}
              </Button>
            </div>
          </>
        ) : message ? (
          <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/8 p-3">
            {message}
          </p>
        ) : null}

        {log.length > 0 ? (
          <ol className="flex flex-col gap-2 border-t pt-3" aria-label="Confirmation history">
            {log.map((entry, index) => (
              <li key={entry.at + index} className="flex flex-col gap-0.5">
                <span className="font-medium">{LOG_RESULT_LABEL[entry.result] ?? entry.result}</span>
                {entry.note ? <span className="whitespace-pre-wrap break-words text-muted-foreground">{entry.note}</span> : null}
                <span className="text-xs text-muted-foreground">{when(entry.at)}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </CardContent>

      <AlertDialog open={cancelOpen} onOpenChange={(open) => (!open && busy === null ? setCancelOpen(false) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>The customer declined on the call. The order is cancelled and its stock goes back. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy !== null}>
              Keep order
            </AlertDialogCancel>
            <AlertDialogAction className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy !== null} onClick={() => void decide("cancel")}>
              {busy === "cancel" ? "Cancelling…" : "Cancel order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

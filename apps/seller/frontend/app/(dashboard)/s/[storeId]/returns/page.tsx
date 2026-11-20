"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircle } from "lucide-react";
import type { SellerReturn, SellerReturnList } from "@markaz/contracts";
import { whatsappLink } from "@markaz/notifications/whatsapp";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { displayPhone } from "@/lib/customer-view";
import { formatRs } from "@/lib/format";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import {
  RETURN_STATUS_LABEL,
  RETURN_TABS,
  REASON_LABEL,
  REFUND_METHOD_LABEL,
  defaultReceiveRows,
  listQuery,
  receiveBody,
  refundLeft,
  refundProblem,
  rejectProblem,
  returnErrorText,
  type ReceiveRow,
  type RefundMethodValue,
  type ReturnStatusValue,
} from "@/lib/returns-view";
import { storeHref } from "@/lib/store-routes";

const dateOf = (iso: string | null): string => (iso === null ? "-" : new Date(iso).toLocaleDateString("en-GB"));

type Notice = { tone: "error" | "success" | "info"; text: string } | null;
type Dialog = { kind: "reject" | "receive" | "refund"; ret: SellerReturn } | null;

/**
 * Sprint 5 EP-13.US02.T04 (D-107, D-108): the seller's Returns. Tabs by status (sent as ?status=: they used to send
 * where[status][equals], which the backend never read, so every tab showed the same list), a card per return with its lines, and the actions
 * of its status: approve or reject, mark received (what came back and what goes back on the shelf), and record a refund in parts. A decision
 * comes with a wa.me link and the text for the customer's phone. Nothing here moves money: the seller pays back by their own means and records it.
 * 375 px first: one column of cards, full-width 44 px buttons, no sideways scroll.
 */
export default function DashboardReturnsPage() {
  const storeId = useActiveStoreId();
  const storeFetch = useStoreFetch();
  const base = `/api/proxy/stores/${encodeURIComponent(storeId)}/returns`;
  const [tab, setTab] = useState<ReturnStatusValue | "all">("requested");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SellerReturnList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [decisionText, setDecisionText] = useState<{ id: string; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await storeFetch(`${base}?${listQuery(tab, page)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as (SellerReturnList & { error?: string }) | null;
      if (!res.ok || !data?.docs) {
        setError(typeof data?.error === "string" ? data.error : "The returns could not be loaded.");
        return;
      }
      setList(data);
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, [storeFetch, base, tab, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Sends one action, then reads the list again from the server (no optimistic update). Returns the answer on success. */
  async function act(ret: SellerReturn, action: "approve" | "reject" | "receive" | "refund", body?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setNotice(null);
    try {
      const res = await storeFetch(`${base}/${encodeURIComponent(ret.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { code?: unknown; error?: unknown }) | null;
      if (!res.ok) {
        const message = typeof data?.error === "string" && res.status !== 409 ? data.error : returnErrorText(res.status, typeof data?.code === "string" ? data.code : null);
        setNotice({ tone: "error", text: message });
        await load();
        return null;
      }
      await load();
      return data;
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
      return null;
    }
  }

  async function approve(ret: SellerReturn) {
    const result = await act(ret, "approve");
    if (result) {
      setNotice({ tone: "success", text: `Return ${ret.returnNumber ?? ""} approved.` });
      if (typeof result.decisionText === "string") setDecisionText({ id: ret.id, text: result.decisionText });
    }
  }

  const counts = list?.counts ?? {};
  const docs = list?.docs ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-4 sm:p-6">
      <PageHeader title="Returns" description="Customers ask for a return from their order page. Approve it, record what came back, and record the refund you paid." className="mb-0" />

      <nav aria-label="Return status" className="flex flex-wrap gap-2">
        {RETURN_TABS.map((item) => {
          const active = tab === item.value;
          const count = item.value === "all" ? counts.all : counts[item.value];
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setTab(item.value);
                setPage(1);
              }}
              aria-pressed={active}
              className={
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium " +
                (active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")
              }
            >
              {item.label}
              {typeof count === "number" ? <span className="tabular-nums opacity-70">{count}</span> : null}
            </button>
          );
        })}
      </nav>

      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}

      {error ? (
        <FormAlert tone="error">
          {error}{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            Try again
          </button>
        </FormAlert>
      ) : list === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading returns…
        </p>
      ) : docs.length === 0 ? (
        <p className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">No returns in this tab.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {docs.map((ret) => (
            <li key={ret.id}>
              <ReturnCard
                storeId={storeId}
                ret={ret}
                decisionText={decisionText?.id === ret.id ? decisionText.text : null}
                onApprove={() => void approve(ret)}
                onOpen={(kind) => setDialog({ kind, ret })}
              />
            </li>
          ))}
        </ul>
      )}

      {list && list.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11" disabled={!list.hasPrevPage} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </Button>
            <Button variant="outline" className="min-h-11" disabled={!list.hasNextPage} onClick={() => setPage((current) => current + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <ReturnDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onReject={async (ret, reason) => {
          const result = await act(ret, "reject", { reason });
          if (result) {
            setNotice({ tone: "success", text: `Return ${ret.returnNumber ?? ""} rejected.` });
            if (typeof result.decisionText === "string") setDecisionText({ id: ret.id, text: result.decisionText });
          }
          setDialog(null);
        }}
        onReceive={async (ret, body) => {
          const result = await act(ret, "receive", body);
          if (result) {
            const note = typeof result.stockNote === "string" && result.stockNote !== "" ? " " + result.stockNote : "";
            setNotice({ tone: "success", text: (result.orderReturned === true ? "Received. Every item of the order is back, so the order is now returned." : "Received.") + note });
          }
          setDialog(null);
        }}
        onRefund={async (ret, body) => {
          const result = await act(ret, "refund", body);
          if (result) setNotice({ tone: "success", text: result.completed === true ? "Refund recorded. This return is fully refunded." : "Refund recorded." });
          setDialog(null);
        }}
      />
    </div>
  );
}

function ReturnCard({
  storeId,
  ret,
  decisionText,
  onApprove,
  onOpen,
}: {
  storeId: string;
  ret: SellerReturn;
  decisionText: string | null;
  onApprove: () => void;
  onOpen: (kind: "reject" | "receive" | "refund") => void;
}) {
  const left = refundLeft(ret.refundCap, ret.refundAmount);
  const wa = decisionText !== null ? whatsappLink(ret.contactPhone, decisionText) : null;
  return (
    <SectionCard>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-all font-mono text-sm font-medium">{ret.returnNumber ?? "Return"}</p>
            <p className="text-xs text-muted-foreground">
              Order {ret.orderNumber ?? "-"} · {dateOf(ret.createdAt)}
            </p>
          </div>
          <StatusBadge status={ret.status} label={RETURN_STATUS_LABEL[ret.status] ?? ret.status} />
        </div>

        <p className="break-words text-sm">
          {ret.customerName ?? "Customer"}
          {ret.contactPhone ? <span className="text-muted-foreground"> · {displayPhone(ret.contactPhone)}</span> : null}
        </p>

        <ul className="flex flex-col gap-1 text-sm">
          {ret.items.map((item) => (
            <li key={item.productId + "|" + item.variantId} className="flex min-w-0 justify-between gap-3">
              <span className="min-w-0 break-words">
                {item.productTitle}
                {item.variantTitle && item.variantTitle !== "Default" ? ` (${item.variantTitle})` : ""} × {item.quantity}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatRs(item.unitPrice * item.quantity)}</span>
            </li>
          ))}
        </ul>

        <p className="text-sm">
          <span className="font-medium">{REASON_LABEL[ret.reasonCode] ?? ret.reasonCode}</span>
          {ret.note ? <span className="whitespace-pre-wrap break-words text-muted-foreground">: {ret.note}</span> : null}
        </p>
        {ret.rejectReason ? <p className="break-words text-sm text-muted-foreground">Your reason: {ret.rejectReason}</p> : null}

        {ret.received.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Received: {ret.received.map((entry) => `${entry.quantity}${entry.restock ? " (restocked)" : " (not restocked)"}`).join(", ")}
          </p>
        ) : null}

        {ret.status === "received" || ret.status === "refunded" ? (
          <div className="rounded-xl bg-muted/40 p-3 text-sm">
            <p>
              Refunded <span className="font-medium tabular-nums">{formatRs(ret.refundAmount)}</span>
              {ret.refundCap !== null ? <span className="text-muted-foreground"> of {formatRs(ret.refundCap)} (the price of what came back, less any discount share, without delivery)</span> : null}
            </p>
            {ret.refunds.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {ret.refunds.map((refund, index) => (
                  <li key={refund.at + index}>
                    {formatRs(refund.amount)} by {REFUND_METHOD_LABEL[refund.method] ?? refund.method}
                    {refund.reference ? ` (${refund.reference})` : ""} · {dateOf(refund.at)}
                  </li>
                ))}
              </ul>
            ) : null}
            {ret.paymentMethod === "card" ? <p className="mt-1 text-xs text-muted-foreground">Refunds of card orders are not supported yet.</p> : null}
          </div>
        ) : null}

        {wa !== null ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 sm:w-auto sm:self-start"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Tell the customer on WhatsApp
          </a>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {ret.status === "requested" ? (
            <>
              <Button className="min-h-11 w-full sm:w-auto" onClick={onApprove}>
                Approve
              </Button>
              <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => onOpen("reject")}>
                Reject
              </Button>
            </>
          ) : null}
          {ret.status === "approved" ? (
            <Button className="min-h-11 w-full sm:w-auto" onClick={() => onOpen("receive")}>
              Mark received
            </Button>
          ) : null}
          {ret.status === "received" && ret.paymentMethod !== "card" && left > 0 ? (
            <Button className="min-h-11 w-full sm:w-auto" onClick={() => onOpen("refund")}>
              Record a refund
            </Button>
          ) : null}
          <Link href={storeHref(storeId, "/orders")} className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">
            Orders
          </Link>
        </div>
      </div>
    </SectionCard>
  );
}

function ReturnDialogs({
  dialog,
  onClose,
  onReject,
  onReceive,
  onRefund,
}: {
  dialog: Dialog;
  onClose: () => void;
  onReject: (ret: SellerReturn, reason: string) => Promise<void>;
  onReceive: (ret: SellerReturn, body: Record<string, unknown>) => Promise<void>;
  onRefund: (ret: SellerReturn, body: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<ReceiveRow[]>([]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<RefundMethodValue>("cash");
  const [reference, setReference] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // Each time a dialog opens it starts from this return's own values.
  useEffect(() => {
    setBusy(false);
    setProblem(null);
    setReason("");
    setReference("");
    setMethod("cash");
    if (dialog?.kind === "receive") setRows(defaultReceiveRows(dialog.ret.items));
    if (dialog?.kind === "refund") setAmount(String(refundLeft(dialog.ret.refundCap, dialog.ret.refundAmount)));
  }, [dialog]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }

  const ret = dialog?.ret ?? null;
  const left = ret ? refundLeft(ret.refundCap, ret.refundAmount) : 0;
  return (
    <AlertDialog open={dialog !== null} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <AlertDialogContent>
        {dialog?.kind === "reject" && ret ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject return {ret.returnNumber}?</AlertDialogTitle>
              <AlertDialogDescription>The customer is told your reason. At least 5 characters.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="reject-reason">Reason</Label>
              <Textarea id="reject-reason" rows={3} value={reason} maxLength={220} onChange={(event) => setReason(event.target.value)} disabled={busy} />
              {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy}>
                Keep it
              </AlertDialogCancel>
              <Button
                className="h-11 w-full sm:h-9 sm:w-auto"
                disabled={busy}
                onClick={() => {
                  const issue = rejectProblem(reason);
                  setProblem(issue);
                  if (issue === null) void run(() => onReject(ret, reason.replace(/\s+/g, " ").trim()));
                }}
              >
                {busy ? "Rejecting…" : "Reject return"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}

        {dialog?.kind === "receive" && ret ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Mark return {ret.returnNumber} received</AlertDialogTitle>
              <AlertDialogDescription>Enter how many of each item came back. Items you restock go back on the shelf once.</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-col gap-3">
              {rows.map((row, index) => {
                const item = ret.items[index];
                return (
                  <li key={row.productId + "|" + row.variantId} className="flex flex-col gap-1.5">
                    <p className="break-words text-sm font-medium">
                      {item?.productTitle}
                      {item?.variantTitle && item.variantTitle !== "Default" ? ` (${item.variantTitle})` : ""}
                    </p>
                    <div className="flex items-center gap-3">
                      <Input
                        aria-label={`Quantity received, up to ${row.asked}`}
                        className="h-11 w-24"
                        inputMode="numeric"
                        value={row.quantity}
                        onChange={(event) => setRows((current) => current.map((entry, i) => (i === index ? { ...entry, quantity: event.target.value } : entry)))}
                        disabled={busy}
                      />
                      <span className="text-xs text-muted-foreground">of {row.asked}</span>
                      <label className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm">
                        <input type="checkbox" checked={row.restock} onChange={(event) => setRows((current) => current.map((entry, i) => (i === index ? { ...entry, restock: event.target.checked } : entry)))} disabled={busy} />
                        Restock
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
            {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy}>
                Cancel
              </AlertDialogCancel>
              <Button
                className="h-11 w-full sm:h-9 sm:w-auto"
                disabled={busy}
                onClick={() => {
                  const result = receiveBody(rows);
                  setProblem(result.problem);
                  if (result.body) void run(() => onReceive(ret, result.body as unknown as Record<string, unknown>));
                }}
              >
                {busy ? "Saving…" : "Mark received"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}

        {dialog?.kind === "refund" && ret ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Record a refund for {ret.returnNumber}</AlertDialogTitle>
              <AlertDialogDescription>
                Record what you paid the customer back by your own means. Nothing is sent from here. Up to {formatRs(left)} is left on this return.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="refund-amount">Amount (Rs.)</Label>
                <Input id="refund-amount" className="h-11" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-method">Paid by</Label>
                <select id="refund-method" className="h-11 rounded-lg border bg-background px-3 text-sm" value={method} onChange={(event) => setMethod(event.target.value as RefundMethodValue)} disabled={busy}>
                  {(Object.keys(REFUND_METHOD_LABEL) as RefundMethodValue[]).map((value) => (
                    <option key={value} value={value}>
                      {REFUND_METHOD_LABEL[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="refund-reference">Reference (optional, only you see it)</Label>
                <Input id="refund-reference" className="h-11" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} autoComplete="off" disabled={busy} />
              </div>
              {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={busy}>
                Cancel
              </AlertDialogCancel>
              <Button
                className="h-11 w-full sm:h-9 sm:w-auto"
                disabled={busy}
                onClick={() => {
                  const issue = refundProblem({ amount, left, reference });
                  setProblem(issue);
                  if (issue === null) void run(() => onRefund(ret, { amount: Number(amount.replace(/[,\s]/g, "")), method, ...(reference.trim() === "" ? {} : { reference: reference.trim() }) }));
                }}
              >
                {busy ? "Saving…" : "Record refund"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

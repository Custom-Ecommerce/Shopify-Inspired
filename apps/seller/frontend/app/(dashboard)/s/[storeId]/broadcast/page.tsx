"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import type { BroadcastList, BroadcastPreview, BroadcastRow, CustomerList, CustomerRow } from "@markaz/contracts";
import { whatsappLink } from "@markaz/notifications/whatsapp";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";

const SUBJECT_MAX = 120;
const MESSAGE_MAX = 2000;
const PAGE = 20;

type Notice = { tone: "error" | "success"; text: string } | null;

async function problemOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

/**
 * Sprint 4 EP-07.US04 (D-092): broadcast to customers. Email: write it, preview how many customers would get it, confirm, and
 * the emails are queued (the platform sends them in batches). WhatsApp: no API, so a list of wa.me links with the message
 * filled in that the seller opens one by one by hand. Everything goes through the BFF proxy; nothing is sent from the browser.
 */
export default function DashboardBroadcastPage() {
  const storeId = useActiveStoreId();
  const storeFetch = useStoreFetch();
  const base = `/api/proxy/stores/${encodeURIComponent(storeId)}`;

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerPage, setCustomerPage] = useState(0);
  const [customerPages, setCustomerPages] = useState(1);
  const [customersBusy, setCustomersBusy] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);

  const loadHistory = useCallback(
    async (page: number) => {
      setHistoryError(null);
      try {
        const res = await storeFetch(`${base}/broadcast?page=${page}&limit=${PAGE}`, { cache: "no-store" });
        if (!res.ok) {
          setHistoryError(await problemOf(res, "The history could not be loaded."));
          return;
        }
        const data = (await res.json()) as BroadcastList;
        setHistory((current) => (page === 1 ? data.docs : [...current, ...data.docs]));
        setHistoryPage(data.page);
        setHistoryPages(data.totalPages);
      } catch {
        setHistoryError("Could not reach the server. Please try again.");
      }
    },
    [base, storeFetch],
  );

  const loadCustomers = useCallback(
    async (page: number) => {
      setCustomersBusy(true);
      setCustomersError(null);
      try {
        const res = await storeFetch(`${base}/customers?page=${page}&limit=${PAGE}&phone=1`, { cache: "no-store" });
        if (!res.ok) {
          setCustomersError(await problemOf(res, "The customers could not be loaded."));
          return;
        }
        const data = (await res.json()) as CustomerList;
        setCustomers((current) => (page === 1 ? data.docs : [...current, ...data.docs]));
        setCustomerPage(data.page);
        setCustomerPages(data.totalPages);
      } catch {
        setCustomersError("Could not reach the server. Please try again.");
      } finally {
        setCustomersBusy(false);
      }
    },
    [base, storeFetch],
  );

  useEffect(() => {
    void loadHistory(1);
    void loadCustomers(1);
  }, [loadHistory, loadCustomers]);

  const text = { subject: subject.trim(), message: message.trim() };
  const ready = text.subject !== "" && text.message !== "";

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    // A confirmed count belongs to the text it was previewed for.
    setPreview(null);
    setNotice(null);
  }

  async function runPreview() {
    setBusy("preview");
    setNotice(null);
    try {
      const res = await storeFetch(`${base}/broadcast/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(text),
      });
      if (!res.ok) {
        setNotice({ tone: "error", text: await problemOf(res, "The preview could not be made.") });
        return;
      }
      setPreview((await res.json()) as BroadcastPreview);
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (preview === null) return;
    setBusy("send");
    setNotice(null);
    try {
      const res = await storeFetch(`${base}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...text, expectedCount: preview.recipientCount }),
      });
      if (!res.ok) {
        setNotice({ tone: "error", text: await problemOf(res, "The broadcast could not be sent.") });
        if (res.status === 409) setPreview(null);
        return;
      }
      const row = (await res.json()) as BroadcastRow;
      setNotice({ tone: "success", text: `Queued for ${row.recipientCount} customer${row.recipientCount === 1 ? "" : "s"}. The emails go out in batches over the next few minutes.` });
      setSubject("");
      setMessage("");
      setPreview(null);
      void loadHistory(1);
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title="Broadcast" description="Email your customers, or message them one by one on WhatsApp." className="mb-0" />

      <SectionCard title="Email broadcast" description="One broadcast per day. Every email has an unsubscribe link, and customers who unsubscribed are skipped.">
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="broadcast-subject">Subject</Label>
              <span className={"text-xs " + (subject.length > SUBJECT_MAX ? "font-medium text-destructive" : "text-muted-foreground")}>
                {subject.length}/{SUBJECT_MAX}
              </span>
            </div>
            <Input id="broadcast-subject" className="h-11" value={subject} maxLength={SUBJECT_MAX} onChange={(event) => edit(setSubject, event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="broadcast-message">Message</Label>
              <span className={"text-xs " + (message.length > MESSAGE_MAX ? "font-medium text-destructive" : "text-muted-foreground")}>
                {message.length}/{MESSAGE_MAX}
              </span>
            </div>
            <Textarea id="broadcast-message" rows={6} value={message} maxLength={MESSAGE_MAX} onChange={(event) => edit(setMessage, event.target.value)} placeholder="Plain text only." />
          </div>

          {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}

          {preview === null ? (
            <Button className="min-h-11 w-full sm:w-auto sm:self-start" onClick={() => void runPreview()} disabled={!ready || busy !== null} aria-busy={busy === "preview"}>
              {busy === "preview" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Preview recipients
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4">
              {preview.tooLarge ? (
                <FormAlert tone="error">More than {preview.cap} customers would receive this, which is the most one broadcast can reach. It cannot be sent.</FormAlert>
              ) : preview.recipientCount === 0 ? (
                <FormAlert tone="info">No customer with an email address can receive this yet.</FormAlert>
              ) : (
                <>
                  <p className="text-sm">
                    This will email <span className="font-semibold">{preview.recipientCount}</span> customer{preview.recipientCount === 1 ? "" : "s"}. You cannot send another broadcast today.
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                    <span className="block font-medium text-foreground">{text.subject}</span>
                    {text.message}
                  </p>
                </>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                {!preview.tooLarge && preview.recipientCount > 0 ? (
                  <Button className="min-h-11 w-full sm:w-auto" onClick={() => void send()} disabled={busy !== null} aria-busy={busy === "send"}>
                    {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                    Confirm and send to {preview.recipientCount}
                  </Button>
                ) : null}
                <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setPreview(null)} disabled={busy !== null}>
                  Back to editing
                </Button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Past broadcasts" description="Counts are read from the emails of each broadcast and update as they are sent.">
        {historyError ? <FormAlert tone="error">{historyError}</FormAlert> : null}
        {history.length === 0 && !historyError ? <p className="text-sm text-muted-foreground">No broadcast yet.</p> : null}
        <ul className="flex flex-col divide-y">
          {history.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{row.subject}</p>
                <p className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {row.recipientCount} recipient{row.recipientCount === 1 ? "" : "s"}: {row.counts.sent} sent, {row.counts.queued} queued, {row.counts.failed} failed, {row.counts.skipped} skipped
              </p>
            </li>
          ))}
        </ul>
        {historyPage < historyPages ? (
          <Button variant="outline" className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => void loadHistory(historyPage + 1)}>
            Show older
          </Button>
        ) : null}
      </SectionCard>

      <SectionCard title="WhatsApp" description="WhatsApp opens with the message above filled in. Open each customer one by one and press send there.">
        {customersError ? <FormAlert tone="error">{customersError}</FormAlert> : null}
        {customers.length === 0 && !customersBusy && !customersError ? <p className="text-sm text-muted-foreground">No customer with a phone number yet.</p> : null}
        <ul className="flex flex-col divide-y">
          {customers.map((customer) => {
            const link = message.trim() === "" ? null : whatsappLink(customer.whatsapp ?? customer.phone, message);
            return (
              <li key={customer.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{customer.name ?? "Customer"}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {customer.whatsapp ?? customer.phone} · {customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}
                  </p>
                </div>
                {link !== null ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 sm:w-auto"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    Open WhatsApp
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">{message.trim() === "" ? "Write a message first" : "Not a mobile number"}</span>
                )}
              </li>
            );
          })}
        </ul>
        {customerPage < customerPages ? (
          <Button variant="outline" className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => void loadCustomers(customerPage + 1)} disabled={customersBusy}>
            {customersBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Show more customers
          </Button>
        ) : null}
      </SectionCard>
    </div>
  );
}

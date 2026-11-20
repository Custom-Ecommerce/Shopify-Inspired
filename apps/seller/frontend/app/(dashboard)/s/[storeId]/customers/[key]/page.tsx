"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import type { CustomerDetail, CustomerNoteResult } from "@markaz/contracts";
import { whatsappLink } from "@markaz/notifications/whatsapp";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { NOTE_MAX, displayName, displayPhone, noteProblem, parseTags } from "@/lib/customer-view";
import { formatRs } from "@/lib/format";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";

const dateOf = (iso: string | null): string => (iso === null ? "-" : new Date(iso).toLocaleDateString("en-GB"));

async function problemOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

/** The route param as the customer key. Next may hand it over still percent-encoded (an @ or a +). */
function decodeKey(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type Notice = { tone: "error" | "success"; text: string } | null;

/**
 * Sprint 5 EP-10.US02 (D-107): one customer. Statistics, the seller's private note and tags (never shown to the customer), the
 * customer's orders newest first, their delivery addresses and a WhatsApp link (wa.me, the seller sends from their own phone).
 * 375 px first: one column, no sideways scroll.
 */
export default function DashboardCustomerPage() {
  const storeId = useActiveStoreId();
  const params = useParams<{ key: string }>();
  const key = decodeKey(String(params.key ?? ""));
  const storeFetch = useStoreFetch();
  const url = `/api/proxy/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(key)}`;

  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [note, setNote] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await storeFetch(url, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setError(await problemOf(res, "The customer could not be loaded."));
        return;
      }
      const data = (await res.json()) as CustomerDetail;
      setDetail(data);
      setNote(data.note);
      setTagsText(data.tags.join(", "));
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, [storeFetch, url]);

  useEffect(() => {
    void load();
  }, [load]);

  const listHref = storeHref(storeId, "/customers");

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <BackLink to={listHref} />
        <FormAlert tone="info">This customer was not found in your store.</FormAlert>
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <BackLink to={listHref} />
        {error ? (
          <FormAlert tone="error">
            {error}{" "}
            <button type="button" className="font-medium underline" onClick={() => void load()}>
              Try again
            </button>
          </FormAlert>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading customer…
          </p>
        )}
      </div>
    );
  }

  const tags = parseTags(tagsText);
  const problem = noteProblem(note, tags);
  const dirty = note.trim() !== detail.note || tags.join("\n") !== detail.tags.join("\n");
  const wa = whatsappLink(detail.whatsapp ?? detail.phone, "");

  async function saveNote() {
    if (problem !== null) {
      setNotice({ tone: "error", text: problem });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await storeFetch(`${url}/note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim(), tags }),
      });
      if (!res.ok) {
        setNotice({ tone: "error", text: await problemOf(res, "The note could not be saved.") });
        return;
      }
      const saved = (await res.json()) as CustomerNoteResult;
      setDetail((current) => (current === null ? current : { ...current, note: saved.note, tags: saved.tags, noteUpdatedAt: saved.updatedAt }));
      setNote(saved.note);
      setTagsText(saved.tags.join(", "));
      setNotice({ tone: "success", text: "Saved." });
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const stats = detail.stats;
  const statItems: ReadonlyArray<[string, string]> = [
    ["Orders", String(stats.orderCount)],
    ["Delivered", String(stats.deliveredCount)],
    ["Cancelled", String(stats.cancelledCount)],
    ["Total spent", formatRs(stats.totalSpent)],
    ["Average order", formatRs(stats.averageOrderValue)],
    ["Returns", String(stats.returnsCount)],
    ["First order", dateOf(stats.firstOrderAt)],
    ["Last order", dateOf(stats.lastOrderAt)],
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-4 sm:p-6">
      <BackLink to={listHref} />

      <PageHeader title={displayName(detail.name, detail.phone, detail.email)} description={[displayPhone(detail.phone), detail.email].filter(Boolean).join(" · ")} className="mb-0">
        {wa !== null ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 sm:w-auto"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            WhatsApp
          </a>
        ) : null}
      </PageHeader>

      {detail.unsubscribed ? <FormAlert tone="info">This customer unsubscribed from your email broadcasts.</FormAlert> : null}

      <SectionCard title="Summary" description="Delivered orders count towards the total spent: the items after the discount, without delivery.">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statItems.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate text-base font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <SectionCard title="Private note and tags" description="Only you see this. It is never shown to the customer.">
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="customer-note">Note</Label>
              <span className={"text-xs " + (note.length > NOTE_MAX ? "font-medium text-destructive" : "text-muted-foreground")}>
                {note.length}/{NOTE_MAX}
              </span>
            </div>
            <Textarea id="customer-note" rows={4} value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} placeholder="For example: prefers a call after 6 pm." />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="customer-tags">Tags</Label>
            <Input id="customer-tags" className="h-11" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="VIP, wholesale" autoComplete="off" />
            <p className="text-xs text-muted-foreground">Separate with commas. Up to 5 tags of 20 characters.</p>
          </div>
          {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
          {problem !== null && dirty ? <p className="text-sm text-destructive">{problem}</p> : null}
          <Button className="min-h-11 w-full sm:w-auto sm:self-start" onClick={() => void saveNote()} disabled={!dirty || saving || problem !== null} aria-busy={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save note
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Orders" description={stats.orderCount > detail.orders.length ? `The newest ${detail.orders.length} of ${stats.orderCount}.` : undefined}>
        {detail.orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders.</p> : null}
        <ul className="flex flex-col divide-y">
          {detail.orders.map((order) => (
            <li key={order.id}>
              <Link href={storeHref(storeId, `/orders/${encodeURIComponent(order.id)}`)} className="flex min-h-11 min-w-0 flex-col gap-1 py-3">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{order.orderId}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatRs(order.total)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>{dateOf(order.createdAt)}</span>
                  <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status] ?? order.status} />
                  <span>{order.paymentMethod ? PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod : "Payment not set"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Delivery addresses" description="Where this customer's orders were sent. Nothing is filled in for them at checkout.">
        {detail.addresses.length === 0 ? <p className="text-sm text-muted-foreground">No address saved on these orders.</p> : null}
        <ul className="flex flex-col gap-2">
          {detail.addresses.map((address) => (
            <li key={address.address + "|" + (address.city ?? "")} className="break-words rounded-xl bg-muted/40 p-3 text-sm">
              {address.address}
              {address.city ? <span className="text-muted-foreground">, {address.city}</span> : null}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link href={to} className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline">
      <ArrowLeft className="size-4" aria-hidden="true" />
      All customers
    </Link>
  );
}

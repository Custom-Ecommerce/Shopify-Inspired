"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import type { BlockedContactList, BlockedContactRow } from "@markaz/contracts";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { customerPath, displayPhone } from "@/lib/customer-view";
import { BLOCK_REASON_MAX, BLOCKLIST_MAX, blockProblem } from "@/lib/fraud-view";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";

type Notice = { tone: "error" | "success"; text: string } | null;

async function problemOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

const dateOf = (iso: string): string => new Date(iso).toLocaleDateString("en-GB");

/**
 * Sprint 5 EP-11.US02.T03 (D-107): the Blocklist. Add a phone or an email with an optional reason, and remove one. A blocked phone or email
 * cannot place an order: the shopper sees a neutral message and no order is created. The seller's own list, never shown to shoppers.
 * 375 px first: one column, full-width buttons, no sideways scroll.
 */
export default function BlocklistPage() {
  const storeId = useActiveStoreId();
  const storeFetch = useStoreFetch();
  const url = `/api/proxy/stores/${encodeURIComponent(storeId)}/blocklist`;
  const [rows, setRows] = useState<BlockedContactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [removing, setRemoving] = useState<BlockedContactRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await storeFetch(url, { cache: "no-store" });
      if (!res.ok) {
        setError(await problemOf(res, "The blocklist could not be loaded."));
        return;
      }
      setRows(((await res.json()) as BlockedContactList).docs);
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, [storeFetch, url]);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = value.trim() === "" && reason === "" ? null : blockProblem({ kind, value, reason });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const issue = blockProblem({ kind, value, reason });
    if (issue !== null) {
      setNotice({ tone: "error", text: issue });
      return;
    }
    setAdding(true);
    setNotice(null);
    try {
      const res = await storeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value: value.trim(), ...(reason.trim() === "" ? {} : { reason: reason.trim() }) }),
      });
      if (!res.ok) {
        setNotice({ tone: "error", text: await problemOf(res, "It could not be added.") });
        return;
      }
      setValue("");
      setReason("");
      setNotice({ tone: "success", text: "Added. New orders from it are refused at checkout." });
      await load();
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (removing === null) return;
    setRemoveBusy(true);
    try {
      const res = await storeFetch(`${url}/${encodeURIComponent(removing.id)}`, { method: "DELETE" });
      // 404: already gone, which is what the seller wanted.
      if (!res.ok && res.status !== 404) setNotice({ tone: "error", text: await problemOf(res, "It could not be removed.") });
      else setNotice({ tone: "success", text: "Removed. This contact can order again." });
      await load();
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  }

  const label = (row: BlockedContactRow): string => (row.kind === "phone" ? displayPhone(row.value) : row.value);

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-4 sm:p-6">
      <Link href={storeHref(storeId, "/store?tab=fraud")} className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Fraud settings
      </Link>
      <PageHeader title="Blocklist" description="A blocked phone or email cannot place an order in your store. The shopper is only told to contact the store." className="mb-0" />

      <SectionCard title="Block a phone or email">
        <form onSubmit={add} className="flex flex-col gap-4" noValidate>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Block a</legend>
            <div className="flex flex-wrap gap-2">
              {(["phone", "email"] as const).map((option) => (
                <label key={option} className={"inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-3 text-sm " + (kind === option ? "border-primary bg-primary/10 font-medium" : "")}>
                  <input type="radio" name="blockKind" className="sr-only" checked={kind === option} onChange={() => setKind(option)} />
                  {option === "phone" ? "Phone number" : "Email address"}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="block-value">{kind === "phone" ? "Mobile number" : "Email address"}</Label>
            <Input
              id="block-value"
              className="h-11"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode={kind === "phone" ? "tel" : "email"}
              placeholder={kind === "phone" ? "0300 1234567" : "name@example.com"}
              autoComplete="off"
              maxLength={254}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="block-reason-field">Reason (optional, only you see it)</Label>
              <span className={"text-xs " + (reason.length > BLOCK_REASON_MAX ? "font-medium text-destructive" : "text-muted-foreground")}>
                {reason.length}/{BLOCK_REASON_MAX}
              </span>
            </div>
            <Input id="block-reason-field" className="h-11" value={reason} onChange={(event) => setReason(event.target.value)} autoComplete="off" maxLength={BLOCK_REASON_MAX + 20} />
          </div>
          {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
          {problem !== null && notice === null ? <p className="text-sm text-destructive">{problem}</p> : null}
          <Button type="submit" className="min-h-11 w-full sm:w-auto sm:self-start" disabled={adding || value.trim() === ""} aria-busy={adding}>
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Add to blocklist
          </Button>
        </form>
      </SectionCard>

      <SectionCard title="Blocked contacts" description={rows === null ? undefined : `${rows.length} of ${BLOCKLIST_MAX}.`}>
        {error ? (
          <FormAlert tone="error">
            {error}{" "}
            <button type="button" className="font-medium underline" onClick={() => void load()}>
              Try again
            </button>
          </FormAlert>
        ) : rows === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one is blocked.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex min-w-0 items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {label(row)} <span className="text-xs font-normal text-muted-foreground">({row.kind === "phone" ? "phone" : "email"})</span>
                  </p>
                  <p className="break-words text-sm text-muted-foreground">
                    {row.reason !== "" ? row.reason + " · " : ""}Added {dateOf(row.createdAt)}
                  </p>
                  <Link href={customerPath(storeHref(storeId), row.value)} className="text-xs underline-offset-4 hover:underline">
                    View customer
                  </Link>
                </div>
                <Button type="button" variant="ghost" className="min-h-11 min-w-11 shrink-0" aria-label={"Remove " + label(row)} onClick={() => setRemoving(row)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AlertDialog open={removing !== null} onOpenChange={(open) => (!open && !removeBusy ? setRemoving(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from the blocklist?</AlertDialogTitle>
            <AlertDialogDescription>{removing ? label(removing) : ""} will be able to place orders again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={removeBusy}>
              Keep blocked
            </AlertDialogCancel>
            <AlertDialogAction className="h-11 w-full sm:h-9 sm:w-auto" disabled={removeBusy} onClick={() => void remove()}>
              {removeBusy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

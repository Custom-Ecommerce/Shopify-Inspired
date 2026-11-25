"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import type { ReferralOverview } from "@markaz/contracts/referral";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { NO_LINK_TEXT, OWNER_ONLY_TEXT, earnedText, howItWorksText, joinedText, rewardText, shareText, statusText } from "@/lib/referrals-view";
import { roleCan } from "@/lib/role-access";

/**
 * Sprint 8 (S8-B5, D-118): the owner's referrals, read only: the code, the share link, the referred sellers (masked names, never an email) and what they earned.
 */
export default function ReferralsPage() {
  const { activeStore } = useDashboard();
  const owner = roleCan(activeStore.role, "referrals.read");
  const storeFetch = useStoreFetch();
  const [data, setData] = useState<ReferralOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await storeFetch("/api/dashboard/referrals", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (ReferralOverview & { error?: string }) | null;
      if (!res.ok || !body?.code) {
        setLoadError(body?.error ?? "Your referrals could not be loaded.");
        return;
      }
      setData(body);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    }
  }, [storeFetch]);

  useEffect(() => {
    if (owner) void load();
  }, [owner, load]);

  async function copy() {
    if (data === null) return;
    try {
      await navigator.clipboard.writeText(shareText(data));
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-4 sm:p-6">
      <PageHeader title="Referrals" description="Invite other sellers to Markazify." className="mb-0" />

      {!owner ? (
        <p className="text-sm text-muted-foreground">{OWNER_ONLY_TEXT}</p>
      ) : loadError ? (
        <FormAlert tone="error">
          {loadError}{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            Try again
          </button>
        </FormAlert>
      ) : data === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      ) : (
        <>
          <SectionCard title="Your referral link">
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-sm">{howItWorksText(data)}</p>
              <p className="text-sm text-muted-foreground">
                Your code: <span className="font-mono font-medium text-foreground">{data.code}</span>
              </p>
              {data.shareLink !== null ? (
                <code className="block break-all rounded-lg border bg-muted/50 p-3 text-xs" data-testid="referral-link">
                  {data.shareLink}
                </code>
              ) : (
                <p className="text-sm text-muted-foreground">{NO_LINK_TEXT}</p>
              )}
              <Button type="button" className="min-h-11 w-full sm:w-auto sm:self-start" onClick={() => void copy()}>
                <Copy className="size-4" aria-hidden="true" />
                {copied === "yes" ? "Copied" : data.shareLink !== null ? "Copy link" : "Copy code"}
              </Button>
              {copied === "failed" ? <p className="text-sm text-destructive">Copying did not work. Select it above and copy it by hand.</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="Your referrals" description={earnedText(data.totals)}>
            {data.referrals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No referrals yet. Share your link to get started.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {data.referrals.map((row) => (
                  <li key={row.id} className="flex min-w-0 flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{row.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {joinedText(row)}. {rewardText(row)}.
                      </p>
                    </div>
                    <StatusBadge status={row.status} label={statusText(row)} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

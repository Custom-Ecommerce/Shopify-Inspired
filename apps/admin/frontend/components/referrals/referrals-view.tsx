"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { TablePagination } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listReferrals } from "@/lib/api/client";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";
import {
  REFERRAL_BADGE_STATUS,
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_VALUES,
  datesText,
  monthsText,
  parseReferralListState,
  rangeProblem,
  referralExportHref,
  referralStateToQuery,
  voidedText,
  type ReferralListState,
} from "@/lib/referrals";

/**
 * The read-only Referrals page at /referrals (Sprint 8 S8-B6). Who referred whom, where each stands and the months earned, with a CSV of rewards. The referred
 * seller is masked by the server. One column of cards from 375 px up.
 */
export function ReferralsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseReferralListState(searchParams), [searchParams]);

  const go = useCallback(
    (next: ReferralListState) => {
      const query = referralStateToQuery(next);
      router.replace(query === "" ? pathname : pathname + "?" + query);
    },
    [router, pathname],
  );

  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const problem = rangeProblem(state.from, state.to);
  const { data, error, loading, refetch } = useAdminFetch((signal) => listReferrals(state, signal), [state.page, state.status, state.q, state.from, state.to]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Referrals</h2>
        <p className="text-sm text-muted-foreground">Sellers who signed up with another seller&apos;s code. Rewards are given by the platform; nothing here can be changed.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-3" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search by referrer" placeholder="Search by referrer name or email" className="min-h-11 pl-9" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="referrals-status">Status</Label>
            <Select id="referrals-status" value={state.status} onChange={(event) => go({ ...state, status: event.target.value as ReferralListState["status"], page: 1 })}>
              {(["all", ...REFERRAL_STATUS_VALUES] as const).map((value) => (
                <option key={value} value={value}>
                  {REFERRAL_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="referrals-from">From</Label>
            <Input id="referrals-from" type="date" className="min-h-11" value={state.from} onChange={(event) => go({ ...state, from: event.target.value, page: 1 })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="referrals-to">To</Label>
            <Input id="referrals-to" type="date" className="min-h-11" value={state.to} onChange={(event) => go({ ...state, to: event.target.value, page: 1 })} />
          </div>
        </div>
        {problem !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : (
          <a
            href={referralExportHref(state)}
            download="referral-rewards.csv"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:self-start"
          >
            <Download className="size-4" aria-hidden />
            Export rewards (CSV)
          </a>
        )}
      </div>

      {error !== null && (data?.docs.length ?? 0) === 0 ? (
        <Card role="alert" className="flex flex-col items-center gap-3 border-destructive/20 bg-destructive/8 px-6 py-10 text-center">
          <p className="max-w-sm text-sm font-medium text-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : loading && !data ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (data?.docs.length ?? 0) === 0 ? (
        <Card className="bg-muted/30 px-4 py-12 text-center">
          <p className="font-heading text-lg font-semibold text-foreground">No referrals here</p>
          <p className="mt-1 text-sm text-muted-foreground">Referrals appear when a seller signs up with a code.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Referrals">
          {data?.docs.map((row) => (
            <li key={row.id}>
              <Card className="flex min-w-0 flex-col gap-2 p-4">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words font-medium">{row.referrer.name || "Seller"}</p>
                  <StatusBadge status={REFERRAL_BADGE_STATUS[row.status]} label={REFERRAL_STATUS_LABELS[row.status]} />
                </div>
                <p className="break-all text-sm text-muted-foreground">{row.referrer.email}</p>
                <p className="text-sm">
                  Referred {row.referred}. {monthsText(row)}.
                </p>
                <p className="text-sm text-muted-foreground">{datesText(row)}</p>
                {voidedText(row) !== null ? <p className="text-sm font-medium text-destructive">{voidedText(row)}</p> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="referral" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}
    </div>
  );
}

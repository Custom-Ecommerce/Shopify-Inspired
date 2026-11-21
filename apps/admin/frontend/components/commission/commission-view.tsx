"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HistoryPanel } from "@/components/commission/history-panel";
import { PayoutHistoryPanel } from "@/components/commission/payout-history-panel";
import { PayoutsPanel } from "@/components/commission/payouts-panel";
import { RatesPanel } from "@/components/commission/rates-panel";
import { Button } from "@/components/ui/button";
import { COMMISSION_VIEWS, VIEW_LABELS, commissionStateToUrl, parseCommissionState, type CommissionListState, type CommissionView } from "@/lib/commission";

/** The commission page at /commission. The view, filters, and page live in the URL, so a view can be shared or reloaded. */
export function CommissionPageView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseCommissionState(searchParams), [searchParams]);

  function go(next: CommissionListState) {
    const query = commissionStateToUrl(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  function switchView(view: CommissionView) {
    if (view !== state.view) go({ view, page: 1, q: "", status: "", mode: "" });
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Commission</h2>
        <p className="text-sm text-muted-foreground">The gateway (card) rate that applies to every store, what the platform owes each store, and the payouts made. Cash on delivery has its own percent in Settings. Amounts are in rupees.</p>
      </div>

      <div role="group" aria-label="Commission view" className="inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {COMMISSION_VIEWS.map((view) => (
          <Button key={view} size="sm" variant={state.view === view ? "default" : "ghost"} aria-pressed={state.view === view} onClick={() => switchView(view)}>
            {VIEW_LABELS[view]}
          </Button>
        ))}
      </div>

      {state.view === "rates" ? (
        <RatesPanel state={state} go={go} />
      ) : state.view === "payouts" ? (
        <PayoutsPanel state={state} go={go} />
      ) : state.view === "payout-history" ? (
        <PayoutHistoryPanel state={state} go={go} />
      ) : (
        <HistoryPanel state={state} go={go} />
      )}
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getTraffic } from "@/lib/api/client";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { NO_TRAFFIC_TEXT, TRAFFIC_NOTE, hasTraffic, totalsText, trafficBars } from "@/lib/traffic";

/** Sprint 8 (S8-B7): platform visits and orders per day, the last 14 days. A read of its own: if it fails, the rest of the overview still shows. */
export function TrafficCard() {
  const { data, error, loading, refetch } = useAdminFetch((signal) => getTraffic(signal), []);

  return (
    <Card className="min-w-0" data-slot="traffic">
      <CardHeader>
        <CardTitle>Visits and orders</CardTitle>
        <CardDescription>{TRAFFIC_NOTE}</CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null && !data ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{error.message}</span>
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : loading && !data ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : !data || !hasTraffic(data) ? (
          <p className="text-sm text-muted-foreground">{NO_TRAFFIC_TEXT}</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm font-medium">{totalsText(data)}</p>
            <ul className="flex flex-col gap-2" aria-label="Visits and orders per day">
              {trafficBars(data).map((bar) => (
                <li key={bar.day} className="grid min-w-0 grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{bar.label}</span>
                  <span className="block h-2 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-primary" style={{ width: bar.width + "%" }} />
                  </span>
                  <span className="text-right tabular-nums">
                    {bar.visits.toLocaleString("en-US")} v, {bar.orders.toLocaleString("en-US")} o
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";
import { DollarSign, ShoppingCart } from "lucide-react";
import type { Analytics, AnalyticsPeriod } from "@markaz/contracts/analytics";
import { SalesExportButton } from "@/components/dashboard/SalesExportButton";
import { ChartCard } from "@/components/dashboard/shared/ChartCard";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { MetricTile } from "@/components/dashboard/shared/MetricTile";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  COUNTERS_NOTE,
  NOT_ALLOWED_TEXT,
  NO_VISITS_TEXT,
  NO_VISITS_TITLE,
  PERIODS,
  PERIOD_LABELS,
  funnelBars,
  hasVisits,
  overallText,
  shortDay,
} from "@/lib/analytics-view";
import { useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { roleCan } from "@/lib/role-access";
import { periodRange } from "@/lib/sales-export";

/**
 * Sprint 8 (S8-B7, D-118): the store's analytics: the funnel and visits from the anonymous counters, sales from the orders, top products by views and by
 * orders, for 7, 30 or 90 days. For the owner and managers.
 */

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--chart-1)",
  confirmed: "var(--chart-2)",
  processing: "var(--chart-3)",
  dispatched: "var(--chart-4)",
  delivered: "var(--chart-5)",
  cancelled: "var(--destructive)",
  returned: "var(--muted-foreground)",
};

const revenueChartConfig = { amount: { label: "Revenue", color: "var(--chart-1)" } } satisfies ChartConfig;
const visitsChartConfig = { visits: { label: "Visits", color: "var(--chart-2)" } } satisfies ChartConfig;
const statusChartConfig = { value: { label: "Orders" } } satisfies ChartConfig;

function RankedList({ rows, empty }: { rows: Array<{ key: string; name: string; value: string }>; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.key} className="flex min-w-0 items-start justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
          <span className="min-w-0 break-words">{row.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardAnalyticsPage() {
  const { activeStore } = useDashboard();
  const allowed = roleCan(activeStore.role, "analytics.read");
  const storeFetch = useStoreFetch();
  const [data, setData] = useState<Analytics | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await storeFetch(`/api/dashboard/analytics?period=${period}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (Analytics & { error?: string }) | null;
      if (!res.ok || !body?.funnel) {
        setErrorMessage(body?.error ?? "Your analytics could not be loaded.");
        return;
      }
      setData(body);
    } catch {
      setErrorMessage("Could not reach the backend.");
    } finally {
      setIsLoading(false);
    }
  }, [period, storeFetch]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) {
    return (
      <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-8">
        <PageHeader title="Analytics" className="mb-0" />
        <p className="text-sm text-muted-foreground">{NOT_ALLOWED_TEXT}</p>
      </div>
    );
  }

  const days = Number.parseInt(period, 10);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Analytics" description="Visits, the path to an order, and sales" className="mb-0">
        <SalesExportButton filters={periodRange(days, new Date())} />
      </PageHeader>

      <Tabs
        value={period}
        onValueChange={(value) => {
          if (value) setPeriod(value as AnalyticsPeriod);
        }}
      >
        <TabsList className="w-full sm:w-auto">
          {PERIODS.map((value) => (
            <TabsTrigger key={value} value={value} className="min-h-11 flex-1 sm:flex-none">
              {PERIOD_LABELS[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={() => void load()} />
      ) : isLoading || !data ? (
        <LoadingState variant="skeleton" />
      ) : (
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCard title="From visit to order" description={hasVisits(data) ? overallText(data.funnel) : undefined}>
            {hasVisits(data) ? (
              <div className="flex min-w-0 flex-col gap-3">
                <ol className="flex flex-col gap-3">
                  {funnelBars(data.funnel).map((bar) => (
                    <li key={bar.key} className="flex min-w-0 flex-col gap-1">
                      <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
                        <span className="font-medium">{bar.label}</span>
                        <span className="tabular-nums">{bar.count.toLocaleString("en-US")}</span>
                      </span>
                      <span className="block h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${bar.width}%` }} />
                      </span>
                      <span className="text-xs text-muted-foreground">{bar.note}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground">{COUNTERS_NOTE}</p>
              </div>
            ) : (
              <EmptyState title={NO_VISITS_TITLE} description={NO_VISITS_TEXT} />
            )}
          </SectionCard>

          <ChartCard title="Visits per day" description="Counted browser sessions">
            {data.traffic.some((day) => day.visits > 0) ? (
              <ChartContainer config={visitsChartConfig} className="h-[220px] w-full">
                <BarChart data={data.traffic}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={shortDay} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={32} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="visits" fill="var(--color-visits)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState title={NO_VISITS_TITLE} description={NO_VISITS_TEXT} />
            )}
          </ChartCard>

          <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
            <SectionCard title="Top products by views">
              <RankedList rows={data.topByViews.map((row) => ({ key: row.slug, name: row.name, value: `${row.views} views` }))} empty="No product views yet." />
            </SectionCard>
            <SectionCard title="Top products by orders">
              <RankedList rows={data.topByOrders.map((row, index) => ({ key: row.slug ?? `${row.name}-${index}`, name: row.name, value: `${row.orders} orders` }))} empty="No orders in this period." />
            </SectionCard>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-4 lg:gap-6">
            <MetricTile label="Avg Order Value" value={`PKR ${data.avgOrderValue.toLocaleString()}`} icon={DollarSign} coinVariant="brand" />
            <MetricTile label="Total Orders" value={data.totalOrders} icon={ShoppingCart} />
          </div>

          <ChartCard title="Revenue" description="Daily order totals, without cancelled and returned orders">
            <ChartContainer config={revenueChartConfig} className="h-[260px] w-full">
              <BarChart data={data.revenue.daily}>
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={shortDay} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={44} />
                <ChartTooltip content={<ChartTooltipContent formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />} />
                <Bar dataKey="amount" fill="var(--color-amount)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </ChartCard>

          <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
            <ChartCard title="Orders by Status">
              <ChartContainer config={statusChartConfig} className="h-[220px] w-full">
                <PieChart>
                  <Pie data={Object.entries(data.ordersByStatus).map(([name, value]) => ({ name, value }))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                    {Object.keys(data.ordersByStatus).map((name) => (
                      <Cell key={name} fill={STATUS_COLORS[name] ?? "var(--muted)"} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                </PieChart>
              </ChartContainer>
            </ChartCard>

            <SectionCard title="Top Cities">
              <RankedList rows={data.topCities.map((c) => ({ key: c.city, name: c.city, value: `${c.orders} orders` }))} empty="No cities yet." />
            </SectionCard>
          </div>

          <SectionCard title="Top products by revenue">
            <RankedList rows={data.topProducts.map((p) => ({ key: p.id, name: p.title, value: `PKR ${p.revenue.toLocaleString()}` }))} empty="No sales in this period." />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

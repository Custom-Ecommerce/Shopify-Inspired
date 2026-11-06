"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { MetricTile } from "@/components/dashboard/shared/MetricTile";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { ChartCard } from "@/components/dashboard/shared/ChartCard";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { DollarSign, ShoppingCart } from "lucide-react";

interface AnalyticsData {
  revenue: { daily: { date: string; amount: number }[] };
  ordersByStatus: Record<string, number>;
  topProducts: {
    id: string;
    title: string;
    revenue: number;
    orders: number;
    viewCount: number;
  }[];
  topCities: { city: string; orders: number }[];
  avgOrderValue: number;
  totalOrders: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--chart-1)",
  confirmed: "var(--chart-2)",
  processing: "var(--chart-3)",
  dispatched: "var(--chart-4)",
  delivered: "var(--chart-5)",
  cancelled: "var(--destructive)",
  returned: "var(--muted-foreground)",
};

const revenueChartConfig = {
  amount: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

const statusChartConfig = {
  value: { label: "Orders" },
} satisfies ChartConfig;

export default function DashboardAnalyticsPage() {
  const storeFetch = useStoreFetch();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    storeFetch(`/api/dashboard/analytics?period=${period}`)
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          setErrorMessage(d.error);
          return;
        }
        setData(d);
      })
      .catch(() => setErrorMessage("Could not reach the backend."))
      .finally(() => setIsLoading(false));
  }, [period, storeFetch]);

  const statusData = data
    ? Object.entries(data.ordersByStatus).map(([status, count]) => ({
        name: status,
        value: count,
      }))
    : [];

  const productColumns = [
    { header: "Product", accessorKey: "title" as const },
    {
      header: "Revenue",
      render: (p: { revenue: number }) => (
        <span className="tabular-nums">PKR {p.revenue.toLocaleString()}</span>
      ),
    },
    { header: "Orders", accessorKey: "orders" as const },
    { header: "Views", accessorKey: "viewCount" as const },
  ];

  // Period selector used as ChartCard headerAction
  const periodSelector = (
    <Tabs
      value={period}
      onValueChange={(v) => {
        if (v) setPeriod(v as typeof period);
      }}
    >
      <TabsList>
        {(["7d", "30d", "90d"] as const).map((p) => (
          <TabsTrigger key={p} value={p}>
            {p}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  return (
    <div className="p-6 sm:p-8">
      <PageHeader
        title="Analytics"
        description="Sales performance and customer insights"
      />

      {errorMessage ? (
        <ErrorState
          message={errorMessage}
          onRetry={() => setPeriod(period)}
          className="mb-6"
        />
      ) : isLoading || !data ? (
        <LoadingState variant="skeleton" />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Metric summary row */}
          <div className="grid grid-cols-2 gap-4 lg:gap-6">
            <MetricTile
              label="Avg Order Value"
              value={`PKR ${data.avgOrderValue.toLocaleString()}`}
              icon={DollarSign}
              coinVariant="brand"
            />
            <MetricTile
              label="Total Orders"
              value={data.totalOrders}
              icon={ShoppingCart}
            />
          </div>

          {/* Revenue chart: ChartCard provides the plot tray */}
          <ChartCard
            title="Revenue (delivered orders)"
            description="Daily delivered order totals"
            periodSelector={periodSelector}
          >
            <ChartContainer
              config={revenueChartConfig}
              className="h-[260px] w-full"
            >
              <BarChart data={data.revenue.daily}>
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(d) => d.slice(5)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) =>
                        `PKR ${Number(value).toLocaleString()}`
                      }
                    />
                  }
                />
                <Bar
                  dataKey="amount"
                  fill="var(--color-amount)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Orders by Status donut */}
            <ChartCard title="Orders by Status">
              <ChartContainer
                config={statusChartConfig}
                className="h-[220px] w-full"
              >
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                  >
                    {statusData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={STATUS_COLORS[entry.name] ?? "var(--muted)"}
                      />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                </PieChart>
              </ChartContainer>
            </ChartCard>

            {/* Top Cities list */}
            <SectionCard title="Top Cities">
              <ul className="flex flex-col gap-2">
                {data.topCities.map((c) => (
                  <li
                    key={c.city}
                    className="flex justify-between border-b border-border/50 py-2 text-sm last:border-0"
                  >
                    <span>{c.city}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.orders} orders
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* Top Products table */}
          <SectionCard title="Top Products" noPadding>
            <DataTable
              data={data.topProducts}
              columns={productColumns}
              keyExtractor={(p) => p.id}
            />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

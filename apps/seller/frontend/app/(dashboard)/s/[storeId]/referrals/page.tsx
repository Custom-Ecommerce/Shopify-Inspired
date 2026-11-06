"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/lib/dashboard-context";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";

interface ReferralDoc {
  id: string;
  referred: string | { name?: string; slug?: string };
  status: "pending" | "rewarded";
  rewardType?: string;
  rewardValue?: number;
  createdAt: string;
}

export default function DashboardReferralsPage() {
  const storeFetch = useStoreFetch();
  const { store } = useDashboard();
  const [referrals, setReferrals] = useState<ReferralDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    storeFetch("/api/dashboard/referrals")
      .then((res) => res.json())
      .then((data) => setReferrals(data.docs ?? []))
      .finally(() => setLoading(false));
  }, [storeFetch]);

  const referralLink =
    store?.referralCode && typeof window !== "undefined" ? `${window.location.origin}/signup?ref=${store.referralCode}` : "";

  function handleCopy() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!store) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="font-heading text-2xl mb-2">Referrals</h1>
        <p className="text-sm text-muted-foreground">Store details could not be loaded. Try refreshing the page.</p>
      </div>
    );
  }

  const columns = [
    {
      header: "Store",
      render: (r: ReferralDoc) => typeof r.referred === "object" ? r.referred?.name : r.referred,
    },
    {
      header: "Status",
      render: (r: ReferralDoc) => <StatusBadge status={r.status} />,
    },
    {
      header: "Reward",
      render: (r: ReferralDoc) => (
        <span className="text-xs">
          {r.rewardType ? `${r.rewardType} (${r.rewardValue})` : "—"}
        </span>
      ),
    },
    {
      header: "Date",
      render: (r: ReferralDoc) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Referrals" />

      <SectionCard title="Your referral link" className="mb-8 max-w-xl">
        <div className="flex gap-2">
          <Input readOnly value={referralLink} className="font-mono" />
          <Button variant="outline" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Share this with other sellers — when they sign up and complete their first delivered order, you both
          get rewarded.
        </p>
      </SectionCard>

      <h2 className="font-heading text-lg mb-3">Your Referrals</h2>
      {loading ? (
        <LoadingState />
      ) : referrals.length === 0 ? (
        <EmptyState title="No referrals yet" description="Share your link to get started." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={referrals}
            columns={columns}
            keyExtractor={(r) => r.id}
          />
        </SectionCard>
      )}
    </div>
  );
}

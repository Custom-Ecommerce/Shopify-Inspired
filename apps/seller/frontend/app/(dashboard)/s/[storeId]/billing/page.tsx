"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { Suspense, useState } from "react";
import { useDashboard } from "@/lib/dashboard-context";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { toast } from "sonner";

/*
 * Sprint 4 EP-04.US03.T03 (D-088): Stripe Connect is gone. Stripe does not serve Pakistani merchants, so card money is
 * collected by the platform and paid to the seller by settlement, after commission. This page keeps only the two
 * payment switches (saved with the store settings PATCH); the payout details and the full Payments tab come with the
 * settings screens (SB-5).
 */
function BillingContent() {
  const storeFetch = useStoreFetch();
  const { store, storeId } = useDashboard();

  const [saving, setSaving] = useState(false);
  const [codEnabled, setCodEnabled] = useState(store?.paymentSettings?.codEnabled ?? true);
  const [cardEnabled, setCardEnabled] = useState(store?.paymentSettings?.cardEnabled ?? true);

  async function savePaymentSettings() {
    if (!codEnabled && !cardEnabled) {
      toast.error("Keep at least one payment method on.");
      return;
    }
    setSaving(true);
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payments: { codEnabled, cardEnabled } }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to save settings");
      }
      toast.success("Payment settings saved!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 p-4 sm:p-8">
      <h1 className="font-heading text-2xl font-semibold tracking-tight mb-6">Billing &amp; Payments</h1>

      <div className="flex max-w-2xl flex-col gap-6">
        <SectionCard title="Payment Methods" description="Choose how customers can pay for their orders on your store.">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="cod" className="flex flex-col gap-1">
                <span>Cash on Delivery</span>
                <span className="font-normal text-sm text-muted-foreground">Customers pay the courier when the order is delivered.</span>
              </Label>
              <Switch id="cod" checked={codEnabled} onCheckedChange={setCodEnabled} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="card" className="flex flex-col gap-1">
                <span>Card Payments</span>
                <span className="font-normal text-sm text-muted-foreground">
                  Card money is collected by the platform and paid out to you after commission.
                </span>
              </Label>
              <Switch id="card" checked={cardEnabled} onCheckedChange={setCardEnabled} />
            </div>

            <Button variant="clay" className="min-h-11" onClick={savePaymentSettings} disabled={saving}>
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BillingContent />
    </Suspense>
  );
}

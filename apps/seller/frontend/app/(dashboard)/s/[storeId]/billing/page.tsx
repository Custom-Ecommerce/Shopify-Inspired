"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useDashboard, useStoreHref } from "@/lib/dashboard-context";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { toast } from "sonner";

function BillingContent() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const { store, storeId } = useDashboard();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [codEnabled, setCodEnabled] = useState(store?.paymentSettings?.codEnabled ?? true);
  const [cardEnabled, setCardEnabled] = useState(store?.paymentSettings?.cardEnabled ?? false);
  const [onboarding, setOnboarding] = useState(false);

  const isStripeActive = store?.billing?.stripeOnboardingStatus === "complete" && store?.billing?.stripeChargesEnabled;
  const isStripePending = store?.billing?.stripeOnboardingStatus === "pending";

  useEffect(() => {
    if (searchParams.get("onboarded") === "true") {
      toast.success("Stripe account connected successfully!");
      router.replace(href("/billing"));
    } else if (searchParams.get("refresh") === "true") {
      toast.info("Stripe onboarding refreshed.");
      router.replace(href("/billing"));
    }
  }, [searchParams, router, href]);

  async function handleConnectStripe() {
    setOnboarding(true);
    try {
      const res = await storeFetch("/api/proxy/stripe/connect-onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start onboarding");
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No URL returned");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to connect to Stripe.");
      setOnboarding(false);
    }
  }

  async function savePaymentSettings() {
    if (cardEnabled && !isStripeActive) {
      toast.error("You must complete Stripe onboarding before enabling Card Payments.");
      return;
    }
    setSaving(true);
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentSettings: {
            codEnabled,
            cardEnabled,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      toast.success("Payment settings saved!");
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 p-6 sm:p-8">
      <h1 className="font-heading text-2xl font-semibold tracking-tight mb-6">Billing &amp; Payments</h1>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-4xl">
        {/* Stripe Connect */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <SectionCard
            title="Stripe Connect"
            description="Connect your bank account to receive payouts for card payments."
          >
            <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Onboarding Status</div>
                <div className="text-sm">
                  {isStripeActive ? (
                    <span className="font-medium text-success">Active (Charges Enabled)</span>
                  ) : isStripePending ? (
                    <span className="font-medium text-warning">Pending Verification</span>
                  ) : (
                    <span className="font-medium text-muted-foreground">Not Started</span>
                  )}
                </div>
              </div>
              {!isStripeActive && (
                <Button variant="clay" onClick={handleConnectStripe} disabled={onboarding}>
                  {onboarding ? "Redirecting…" : isStripePending ? "Continue Onboarding" : "Connect Stripe"}
                </Button>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Payment Methods"
            description="Choose how customers can pay for their orders on your store."
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="cod" className="flex flex-col gap-1">
                  <span>Cash on Delivery</span>
                  <span className="font-normal text-sm text-muted-foreground">
                    Accept payments when the order is delivered.
                  </span>
                </Label>
                <Switch
                  id="cod"
                  checked={codEnabled}
                  onCheckedChange={setCodEnabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="card" className="flex flex-col gap-1">
                  <span>Card Payments (Stripe)</span>
                  <span className="font-normal text-sm text-muted-foreground">
                    Accept Credit and Debit cards.{" "}
                    {!isStripeActive && "Requires Stripe Connect to be active."}
                  </span>
                </Label>
                <Switch
                  id="card"
                  checked={cardEnabled}
                  onCheckedChange={setCardEnabled}
                  disabled={!isStripeActive}
                />
              </div>

              <Button variant="clay" onClick={savePaymentSettings} disabled={saving}>
                {saving ? "Saving…" : "Save Settings"}
              </Button>
            </div>
          </SectionCard>
        </div>
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

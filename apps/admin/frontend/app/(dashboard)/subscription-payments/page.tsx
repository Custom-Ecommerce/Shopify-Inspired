import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsView } from "@/components/subscription-payments/payments-view";

export const metadata: Metadata = { title: "Subscription payments" };

export default function SubscriptionPaymentsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentsView />
    </Suspense>
  );
}

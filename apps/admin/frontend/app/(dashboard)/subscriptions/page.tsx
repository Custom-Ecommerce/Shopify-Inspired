import type { Metadata } from "next";
import { Suspense } from "react";
import { SubscriptionsView } from "@/components/subscriptions/subscriptions-view";

export const metadata: Metadata = { title: "Subscriptions" };

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionsView />
    </Suspense>
  );
}

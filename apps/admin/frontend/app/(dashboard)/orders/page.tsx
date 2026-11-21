import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersView } from "@/components/orders/orders-view";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersView />
    </Suspense>
  );
}

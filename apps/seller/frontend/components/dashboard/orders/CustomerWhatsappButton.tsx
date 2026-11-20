"use client";

import type { DashboardOrderDetail } from "@markaz/contracts";
import { MessageCircle } from "lucide-react";
import { sellerToCustomerWhatsappLink } from "@markaz/notifications/whatsapp";
import { useEffect, useState } from "react";
import type { StoreSettings } from "@markaz/contracts/store-settings";
import { useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";

/**
 * EP-07.US01.T05: "Message customer on WhatsApp" on the order page, for confirmed, dispatched (with courier and tracking
 * number) and delivered orders. It opens wa.me with the status text of the shared templates (no API, D-091), to the
 * customer's WhatsApp number or else their phone. Nothing is shown when the status or the number does not fit.
 */
export function CustomerWhatsappButton({ order }: { order: DashboardOrderDetail }) {
  const { activeStore } = useDashboard();
  const storeFetch = useStoreFetch();
  // EP-07.US02.T02: the seller's own WhatsApp text from the store settings. Until it is read, or when there is none, the
  // platform text is used.
  const [override, setOverride] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(activeStore.id)}/settings`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { settings?: StoreSettings };
        if (!cancelled) setOverride(data.settings?.messages?.whatsappTemplate ?? null);
      } catch {
        // The platform text is used.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeFetch, activeStore.id]);
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN_URL || "localhost:3000";
  const protocol = root.includes("localhost") ? "http" : "https";
  const trackingLink = activeStore.slug ? `${protocol}://${activeStore.slug}.${root}/track?order=${encodeURIComponent(order.orderId)}` : null;

  const href = sellerToCustomerWhatsappLink(
    {
      status: order.status,
      orderNumber: order.orderId,
      customerName: order.customerName,
      phone: order.phone,
      customerWhatsapp: order.customerWhatsapp,
      courier: order.courier,
      trackingNumber: order.trackingNumber,
      trackingLink,
    },
    activeStore.name,
    override,
  );
  if (href === null) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 sm:w-auto"
    >
      <MessageCircle className="size-4" aria-hidden="true" />
      Message customer on WhatsApp
    </a>
  );
}

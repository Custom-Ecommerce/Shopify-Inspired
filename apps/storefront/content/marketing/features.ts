import type { LucideIcon } from "lucide-react";
import { Smartphone, Wallet, Truck, MessageCircle, Store, Globe } from "lucide-react";

export type PkValueVisualKind = "cod-whatsapp" | "payments-couriers" | "mobile-store";

export interface PkValueRowItem {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: readonly string[];
  visual: PkValueVisualKind;
}

export const PK_VALUE_ROWS: readonly PkValueRowItem[] = [
  {
    id: "cod",
    eyebrow: "Cash on Delivery",
    title: "Verify COD orders on WhatsApp automatically",
    description:
      "Many Pakistani shoppers pay on delivery, but fake orders waste courier fees. When a buyer places a COD order, Markazify sends an automatic WhatsApp confirmation and marks the order verified as soon as they reply.",
    bullets: [
      "Automatic WhatsApp message sent right after checkout",
      "Order status updates to Confirmed when the buyer replies YES",
      "Fewer fake dispatches and lower return (RTO) costs",
    ],
    visual: "cod-whatsapp",
  },
  {
    id: "payments-couriers",
    eyebrow: "Payments & Couriers",
    title: "Local wallets and couriers built in",
    description:
      "Accept JazzCash, EasyPaisa, and Cash on Delivery without chasing payment screenshots. Book shipments with TCS, Leopards, and Trax directly from your order screen.",
    bullets: [
      "JazzCash, EasyPaisa, and Cash on Delivery ready at checkout",
      "Domestic courier booking for TCS, Leopards, and Trax",
      "All prices and invoices shown in PKR",
    ],
    visual: "payments-couriers",
  },
  {
    id: "mobile",
    eyebrow: "Mobile-First Storefronts",
    title: "Designed for shoppers on phones",
    description:
      "Many shoppers open store links on their phones, from WhatsApp, Instagram, or TikTok. Markazify stores are laid out for small screens, with checkout on one simple screen.",
    bullets: [
      "Clean product pages and thumb-friendly 44px buttons",
      "Checkout built for phone numbers and local city names",
      "Layouts designed for small phone screens, from 360px wide",
    ],
    visual: "mobile-store",
  },
] as const;

export const PAYMENT_AND_COURIER_CHIPS = [
  { label: "JazzCash", group: "Payment" },
  { label: "EasyPaisa", group: "Payment" },
  { label: "Cash on Delivery", group: "Payment" },
  { label: "TCS", group: "Courier" },
  { label: "Leopards", group: "Courier" },
  { label: "Trax", group: "Courier" },
] as const;

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  /** One short detail line shown under the description. */
  detail: string;
  icon: LucideIcon;
}

/** Features page cards. Ids are stable. Copy stays within what the product already states. */
export const FEATURES: FeatureItem[] = [
  {
    id: "cod",
    title: "Cash on Delivery with WhatsApp check",
    description:
      "Send an automatic WhatsApp message after checkout. The order is marked confirmed when the buyer replies YES, which helps cut fake orders.",
    detail: "Buyer replies YES to confirm",
    icon: MessageCircle,
  },
  {
    id: "payments",
    title: "JazzCash and EasyPaisa",
    description: "Accept JazzCash and EasyPaisa alongside Cash on Delivery. Your prices and totals are in PKR.",
    detail: "Prices shown in rupees (Rs)",
    icon: Wallet,
  },
  {
    id: "couriers",
    title: "Courier booking",
    description:
      "Book domestic shipments with TCS, Leopards and Trax from your order screen, without copying details between apps.",
    detail: "TCS, Leopards and Trax",
    icon: Truck,
  },
  {
    id: "mobile",
    title: "Built for phones",
    description:
      "Product pages and checkout are laid out for small screens, so shoppers arriving from WhatsApp, Instagram or TikTok can order easily.",
    detail: "Buttons sized for thumbs (44px)",
    icon: Smartphone,
  },
  {
    id: "catalog",
    title: "Products and orders",
    description: "Add products with prices in PKR, and follow your orders from one dashboard.",
    detail: "Prices in PKR, orders in one list",
    icon: Store,
  },
  {
    id: "domains",
    title: "Subdomain or your own domain",
    description:
      "Start on a free Markazify subdomain. On the Growth plan, connect your own domain such as yourbrand.pk.",
    detail: "Growth plan: your own domain",
    icon: Globe,
  },
];

/**
 * Single source of truth for plans, prices and the comparison table. PKR only (decision D4).
 * Used by the home pricing section and the /pricing page. Do not add plans or prices here
 * without the owner's approval. Transaction fees are not listed until the owner confirms them.
 */
export const PLANS = [
  {
    id: "free",
    name: "Free",
    description: "Everything you need to try selling online.",
    monthlyPrice: 0,
    features: [
      "Up to 10 products",
      "Standard themes",
      "Cash on Delivery",
      "Community support",
      "Markazify subdomain",
    ],
    highlight: false,
    cta: "Start free",
  },
  {
    id: "growth",
    name: "Growth",
    description: "More products, premium themes and your own domain for a growing store.",
    monthlyPrice: 2500,
    features: [
      "Unlimited products",
      "Premium themes",
      "Custom domain support",
      "Local payment gateways",
      "Priority WhatsApp support",
    ],
    highlight: true,
    cta: "Choose Growth",
  },
];

/**
 * Comparison rows. Each value is derived from a plan feature above, so the table
 * cannot promise anything the plan cards do not. Keys are plan ids.
 */
export const COMPARISON_ROWS: readonly { label: string; values: Record<string, string> }[] = [
  { label: "Products", values: { free: "Up to 10", growth: "Unlimited" } },
  { label: "Themes", values: { free: "Standard themes", growth: "Premium themes" } },
  { label: "Payments", values: { free: "Cash on Delivery", growth: "Local payment gateways" } },
  { label: "Domain", values: { free: "Markazify subdomain", growth: "Custom domain support" } },
  { label: "Support", values: { free: "Community support", growth: "Priority WhatsApp support" } },
];

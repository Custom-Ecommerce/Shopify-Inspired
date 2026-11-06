import { readPage, readSearch } from "@/lib/list-state";
import { PAGE_SIZE } from "@/lib/stores";

export const TIER_VALUES = ["basic", "pro", "premium"] as const;
export type TierValue = (typeof TIER_VALUES)[number];

export const TIER_LABELS: Record<TierValue, string> = { basic: "Basic", pro: "Pro", premium: "Premium" };

/** Badge variants for the tiers: the higher the tier, the more the badge stands out. Tones live in the Badge component. */
export const TIER_VARIANTS: Record<TierValue, "neutral" | "secondary" | "default"> = {
  basic: "neutral",
  pro: "secondary",
  premium: "default",
};

export interface SubscriptionListState {
  page: number;
  q: string;
  tier: TierValue | "";
}

export function parseSubscriptionState(params: { get(name: string): string | null }): SubscriptionListState {
  const rawTier = params.get("tier") ?? "";
  return {
    page: readPage(params),
    q: readSearch(params),
    tier: (TIER_VALUES as readonly string[]).includes(rawTier) ? (rawTier as TierValue) : "",
  };
}

/** The query string for a plan list state. Defaults are left out; the backend call adds the page size. */
export function subscriptionStateToQuery(state: SubscriptionListState, withLimit = false): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.q !== "") params.set("q", state.q);
  if (state.tier !== "") params.set("tier", state.tier);
  if (withLimit) params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

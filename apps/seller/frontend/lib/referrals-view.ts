import type { ReferralOverview, ReferralRow } from "@markaz/contracts/referral";

/**
 * Sprint 8 (S8-B5, D-118): the referrals page. Pure: the words and what a row says. The page is read only and shows only what the server sends, which holds a
 * masked name and never an email.
 */

export const OWNER_ONLY_TEXT = "Only the store owner can see referrals.";
export const NO_LINK_TEXT = "The share link is not available right now. Give your code to the person and ask them to sign up with it.";
export const OFF_TEXT = "Referrals are switched off at the moment: new sign-ups with your code are not counted. Anything you already earned stays.";

const months = (count: number): string => `${count} free ${count === 1 ? "month" : "months"}`;

export function howItWorksText(overview: Pick<ReferralOverview, "enabled" | "rewardMonths" | "monthlyCap">): string {
  if (!overview.enabled) return OFF_TEXT;
  return `Share your link with another seller. A referral that qualifies earns you ${months(overview.rewardMonths)}, for at most ${overview.monthlyCap} referrals a month.`;
}

const STATUS_TEXT: Record<ReferralRow["status"], string> = { pending: "Pending", rewarded: "Rewarded", capped: "Monthly limit reached", refused: "Not eligible" };

export const statusText = (row: Pick<ReferralRow, "status">): string => STATUS_TEXT[row.status] ?? "Pending";

export const rewardText = (row: Pick<ReferralRow, "status" | "monthsRewarded">): string =>
  row.status === "rewarded" ? months(row.monthsRewarded) : row.status === "pending" ? "No reward yet" : "No reward";

export const joinedText = (row: Pick<ReferralRow, "createdAt">): string =>
  `Joined ${new Date(row.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" })}`;

export const earnedText = (totals: ReferralOverview["totals"]): string => `${months(totals.monthsEarned)} earned from ${totals.rewarded} of ${totals.referred} referred`;

/** What the copy button copies: the link when there is one, else the code. */
export const shareText = (overview: Pick<ReferralOverview, "code" | "shareLink">): string => overview.shareLink ?? overview.code;

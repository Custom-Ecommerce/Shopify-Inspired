import type { AdminPayment } from "@markaz/contracts";

/**
 * Sprint 6 EP-14 (S6-B4, D-118): the wording, checks and requests of the Subscription payments page. Pure: no I/O, so a test can run it. Money is
 * WHOLE RUPEES. The seller's reference, the reason and the names are plain text: the page shows them as React text nodes (escaped), never as markup.
 */

export const PAYMENT_PAGE_SIZE = 20;

export const PAYMENT_STATUS_VALUES = ["requested", "claimed", "confirmed", "rejected", "void"] as const;
export type PaymentStatusValue = (typeof PAYMENT_STATUS_VALUES)[number];

/** The list shows the payments waiting for a check first (claimed), and every other status or all of them on request. */
export type PaymentStatusFilter = PaymentStatusValue | "all";
export const DEFAULT_PAYMENT_FILTER: PaymentStatusFilter = "claimed";

export interface PaymentListState {
  page: number;
  status: PaymentStatusFilter;
}

/** Anything unreadable falls back to the default, so a hand-edited URL never breaks the page. */
export function parsePaymentListState(params: { get(name: string): string | null }): PaymentListState {
  const rawPage = params.get("page") ?? "";
  const page = /^\d{1,6}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const rawStatus = params.get("status") ?? "";
  const status = rawStatus === "all" ? "all" : (PAYMENT_STATUS_VALUES.find((value) => value === rawStatus) ?? DEFAULT_PAYMENT_FILTER);
  return { page, status };
}

/** The page's own query string: defaults are left out. */
export function paymentStateToQuery(state: PaymentListState): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  if (state.status !== DEFAULT_PAYMENT_FILTER) params.set("status", state.status);
  return params.toString();
}

/** The query of the API call: the status is always explicit ("all" sends none), and the page size is ours. */
export function paymentApiQuery(state: PaymentListState): string {
  const params = new URLSearchParams();
  if (state.status !== "all") params.set("status", state.status);
  if (state.page > 1) params.set("page", String(state.page));
  params.set("limit", String(PAYMENT_PAGE_SIZE));
  return params.toString();
}

export const PAYMENT_FILTER_LABELS: Record<PaymentStatusFilter, string> = {
  claimed: "To check",
  requested: "Waiting for the seller",
  confirmed: "Confirmed",
  rejected: "Rejected",
  void: "Voided",
  all: "All payments",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatusValue, string> = {
  requested: "Not paid yet",
  claimed: "To check",
  confirmed: "Confirmed",
  rejected: "Rejected",
  void: "Voided",
};

/** The key the shared status badge already has a colour for. */
export const PAYMENT_BADGE_STATUS: Record<PaymentStatusValue, string> = {
  requested: "archived",
  claimed: "pending",
  confirmed: "paid",
  rejected: "failed",
  void: "voided",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = { bank: "Bank transfer", jazzcash: "JazzCash", easypaisa: "Easypaisa", other: "Other" };
export const methodLabel = (method: string | null): string => (method === null ? "Not stated" : (PAYMENT_METHOD_LABELS[method] ?? method));

/** "Rs. 2,500": whole rupees, a fixed locale, so the server and the browser print the same thing. */
export const formatRs = (amount: number): string => "Rs. " + amount.toLocaleString("en-US");

// ---------------------------------------------------------------------------------------------------------------------
// Actions

export type PaymentAction = "confirm" | "reject" | "void";

/** The actions an operator has on a payment in its status. Confirm needs the seller to have said they paid; void is the way back for a confirmed one. */
export function availablePaymentActions(payment: Pick<AdminPayment, "status">): PaymentAction[] {
  switch (payment.status) {
    case "claimed":
      return ["confirm", "reject"];
    case "requested":
      return ["reject"];
    case "confirmed":
      return ["void"];
    default:
      return [];
  }
}

export const PAYMENT_REASON_MIN: Record<PaymentAction, number> = { confirm: 3, reject: 5, void: 5 };
export const PAYMENT_REASON_MAX = 300;

export const PAYMENT_ACTION_COPY: Record<PaymentAction, { button: string; title: string; hint: string; confirm: string; done: string }> = {
  confirm: {
    button: "Confirm",
    title: "Confirm this payment",
    hint: "Check that the money is in your account. The seller's plan starts at once and they are told by email.",
    confirm: "Confirm payment",
    done: "Payment confirmed",
  },
  reject: {
    button: "Reject",
    title: "Reject this payment",
    hint: "The seller is told why. Their plan does not change and they can ask again.",
    confirm: "Reject payment",
    done: "Payment rejected",
  },
  void: {
    button: "Void",
    title: "Void this payment",
    hint: "The payment is taken back and the plan goes back to what it was. This only works while nothing else has changed the plan since.",
    confirm: "Void payment",
    done: "Payment voided",
  },
};

/** The same reason rules the contracts have: a minimum per action, 300 at most, plain text (no < or >). Null when the reason is fine. */
export function reasonProblem(action: PaymentAction, reason: string): string | null {
  const trimmed = reason.trim();
  const min = PAYMENT_REASON_MIN[action];
  if (trimmed.length < min) return "Give a reason of at least " + min + " characters.";
  if (trimmed.length > PAYMENT_REASON_MAX) return "The reason can be at most " + PAYMENT_REASON_MAX + " characters.";
  if (/[<>]/.test(trimmed)) return "Use plain text: < and > are not allowed.";
  return null;
}

/** Confirm needs a ticked box (the money was seen) and a reason. */
export function confirmProblems(input: { checked: boolean; reason: string }): { checked?: string; reason?: string } {
  const problems: { checked?: string; reason?: string } = {};
  if (!input.checked) problems.checked = "Tick the box once you have seen the money in your account.";
  const reason = reasonProblem("confirm", input.reason);
  if (reason !== null) problems.reason = reason;
  return problems;
}

/** The body of a confirm: the amount the operator SAW on this screen (the backend refuses a different one) and the reason. */
export function confirmBody(payment: Pick<AdminPayment, "amountRs">, reason: string): { amountRs: number; reason: string } {
  return { amountRs: payment.amountRs, reason: reason.trim() };
}

/** The body of a reject or a void: the reason only. */
export function decideBody(reason: string): { reason: string } {
  return { reason: reason.trim() };
}

/** What the confirm dialog repeats back, so the operator checks the right payment: the seller, the plan, the amount, the method and the reference. */
export function confirmFacts(payment: AdminPayment): Array<{ label: string; value: string }> {
  return [
    { label: "Seller", value: payment.seller.name === "" ? payment.seller.email : payment.seller.name + " (" + payment.seller.email + ")" },
    { label: "Plan", value: payment.planName },
    { label: "Amount", value: formatRs(payment.amountRs) },
    { label: "Paid by", value: methodLabel(payment.method) },
    { label: "Reference", value: payment.reference ?? "Not stated" },
  ];
}

/** A proof link is shown as a link only when it is an https address; anything else is plain text (the backend only stores https, this is the second check). */
export function safeProofHref(proofUrl: string | null): string | null {
  return proofUrl !== null && /^https:\/\/[^\s<>"']+$/i.test(proofUrl) ? proofUrl : null;
}

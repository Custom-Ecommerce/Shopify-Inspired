/*
 * Sprint 5 EP-11 (D-107): the pure rules of the phone confirmation panel, the flag chips, the blocklist and the Fraud tab. Local to this
 * app, which imports @markaz/contracts as types only (the labels repeat the ones in contracts). Checked by test/fraud-view.test.ts.
 */

export type ConfirmationStatusValue = "not_required" | "unconfirmed" | "confirmed" | "unreachable";
export type RiskFlagValue = "high_value" | "flagged_city" | "repeat_returns" | "new_customer";
export type ConfirmationResultValue = "confirmed" | "unreachable" | "cancel";

export const CONFIRMATION_NOTE_MAX = 200;
export const BLOCK_REASON_MAX = 100;
export const BLOCKLIST_MAX = 500;

export const RISK_FLAG_LABEL: Record<RiskFlagValue, string> = {
  high_value: "High order value",
  flagged_city: "Flagged city",
  repeat_returns: "Often returns orders",
  new_customer: "New customer",
};

/** Why an order carries the flag, in the seller's words (the panel of an unconfirmed order shows these). */
export const RISK_FLAG_WHY: Record<RiskFlagValue, string> = {
  high_value: "The order total is above the limit you set.",
  flagged_city: "The delivery city is on your flagged cities list.",
  repeat_returns: "This customer has returned orders before.",
  new_customer: "No earlier order from this phone number.",
};

export const CONFIRMATION_LABEL: Record<ConfirmationStatusValue, string> = {
  not_required: "No confirmation needed",
  unconfirmed: "Needs confirmation",
  confirmed: "Confirmed by phone",
  unreachable: "Customer unreachable",
};

/** A stored value read leniently: anything unknown, or nothing (an older backend), is not_required. */
export function readStatus(value: unknown): ConfirmationStatusValue {
  return value === "unconfirmed" || value === "confirmed" || value === "unreachable" ? value : "not_required";
}

/** The flags that are real flags, once each, in the fixed order. */
export function readFlags(value: unknown): RiskFlagValue[] {
  const order: RiskFlagValue[] = ["high_value", "flagged_city", "repeat_returns", "new_customer"];
  const stored = Array.isArray(value) ? value.map(String) : [];
  return order.filter((flag) => stored.includes(flag));
}

/** A phone as a tel: link: digits and a leading plus only. Null when there is nothing to dial. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const clean = phone.trim().replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return /\d{7,}/.test(clean) ? "tel:" + clean : null;
}

/** The confirmation text for WhatsApp: English first, then Urdu. `total` is already formatted (Rs. 3,250). */
export function confirmationMessage(input: { storeName: string; customerName: string | null; orderNumber: string; total: string }): string {
  const store = input.storeName.trim() || "our store";
  const name = input.customerName?.trim() || "there";
  return (
    `Hi ${name}, this is ${store}. Please confirm your order ${input.orderNumber} (${input.total}, cash on delivery). Reply YES to confirm or tell us what to change.\n` +
    `السلام علیکم ${name}، یہ ${store} ہے۔ براہ کرم اپنا آرڈر ${input.orderNumber} (${input.total}، کیش آن ڈیلیوری) کنفرم کریں۔ تصدیق کے لیے YES لکھیں یا بتائیں کیا تبدیل کرنا ہے۔`
  );
}

/** The problem with a decision note before it is sent, or null when the server would take it. */
export function confirmationNoteProblem(note: string): string | null {
  if (note.length > CONFIRMATION_NOTE_MAX) return `The note can be at most ${CONFIRMATION_NOTE_MAX} characters.`;
  if (/[<>]/.test(note)) return "The note cannot contain < or >.";
  return null;
}

/** The label of each result button and what it will do, as the dialog says it. */
export const RESULT_COPY: Record<ConfirmationResultValue, { button: string; logged: string }> = {
  confirmed: { button: "Customer confirmed", logged: "Confirmed by phone" },
  unreachable: { button: "Could not reach", logged: "Marked unreachable" },
  cancel: { button: "Customer declined: cancel order", logged: "Cancelled on the call" },
};

export const LOG_RESULT_LABEL: Record<string, string> = {
  confirmed: "Confirmed by phone",
  unreachable: "Marked unreachable",
  cancelled: "Cancelled on the call",
};

/** The 409 of a second decision, the 422 of a refused dispatch: said in plain words. */
export function confirmationErrorText(status: number, code: string | null): string {
  if (status === 409 || code === "ORDER_CONFIRMATION_DECIDED") return "This order was already decided, maybe in another tab. It has been refreshed.";
  if (status === 404) return "This order was not found in your store.";
  return "The decision could not be saved. Check your connection and try again.";
}

// ------------------------------------------------------------------------------------------------------------ blocklist

export interface BlockFormInput {
  kind: "phone" | "email";
  value: string;
  reason: string;
}

/** The problem with the blocklist form before it is sent, or null. The server normalizes the value itself. */
export function blockProblem(input: BlockFormInput): string | null {
  const value = input.value.trim();
  if (value === "") return input.kind === "phone" ? "Enter a mobile number." : "Enter an email address.";
  if (input.kind === "phone") {
    const digits = value.replace(/\D/g, "");
    if (!/^(0092|92|0)?3\d{9}$/.test(digits)) return "Enter a valid mobile number, for example 0300 1234567.";
  } else if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(value)) {
    return "Enter a valid email address.";
  }
  if (input.reason.length > BLOCK_REASON_MAX) return `The reason can be at most ${BLOCK_REASON_MAX} characters.`;
  if (/[<>]/.test(input.reason)) return "The reason cannot contain < or >.";
  return null;
}

// ------------------------------------------------------------------------------------------------------------ the Fraud tab

export interface RiskRulesDraft {
  orderValue: string;
  returns: string;
  cities: string[];
}

export interface RiskRulesBody {
  flagOrderValueAbove: number | null;
  flaggedCities: string[];
  flagReturnsAtLeast: number | null;
}

/** The form text as the rules body, or the problems by field path (the keys the server uses, so one error map serves both). */
export function riskRulesBody(draft: RiskRulesDraft): { body: RiskRulesBody | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let value: number | null = null;
  const text = draft.orderValue.replace(/[,\s]/g, "");
  if (text !== "") {
    if (!/^\d{1,8}$/.test(text) || Number(text) < 1 || Number(text) > 10_000_000) {
      errors["fraud.riskRules.flagOrderValueAbove"] = "Enter whole rupees from 1 to 10,000,000, or leave it empty.";
    } else value = Number(text);
  }
  let returns: number | null = null;
  if (draft.returns !== "") {
    const n = Number(draft.returns);
    if (!Number.isInteger(n) || n < 1 || n > 10) errors["fraud.riskRules.flagReturnsAtLeast"] = "Choose a number from 1 to 10.";
    else returns = n;
  }
  if (draft.cities.length > 30) errors["fraud.riskRules.flaggedCities"] = "At most 30 cities.";
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { flagOrderValueAbove: value, flaggedCities: [...draft.cities], flagReturnsAtLeast: returns }, errors };
}

export const MODE_COPY: ReadonlyArray<{ value: "off" | "flagged" | "all"; label: string; description: string }> = [
  { value: "off", label: "Off", description: "No order waits for a call. Orders are dispatched as before." },
  { value: "flagged", label: "Flagged orders only", description: "An order that matches one of the rules below waits for your phone confirmation." },
  { value: "all", label: "Every cash on delivery order", description: "You confirm each cash on delivery order by phone or WhatsApp before you dispatch it." },
];

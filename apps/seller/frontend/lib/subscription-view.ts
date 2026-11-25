/**
 * Sprint 6 EP-14 (S6-B4, D-118): the wording and the checks of the seller's billing page: the plan card, the plan list, the payment form and the
 * payment history. Pure: no I/O, so a test can run it. Money is WHOLE RUPEES. Every text that came from the server or from the admin (payment
 * instructions, a reason, a reference) is plain text: the page shows it as a React text node, which escapes it, and nothing here builds markup.
 */

export const PAYMENT_METHODS = ["bank", "jazzcash", "easypaisa", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "bank", label: "Bank transfer" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "Easypaisa" },
  { value: "other", label: "Other" },
];

export const PAYMENT_STATUSES = ["requested", "claimed", "confirmed", "rejected", "void"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFERENCE_MAX = 100;
export const PROOF_URL_MAX = 300;

export interface PaymentData {
  id: string;
  planKey: string;
  amountRs: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  reference: string | null;
  proofUrl: string | null;
  periodEnd: string | null;
  reason: string | null;
  createdAt: string;
  claimedAt: string | null;
  decidedAt: string | null;
}

export type SubscriptionStatus = "trial" | "active" | "grace" | "expired" | "cancelled";

export interface SubscriptionData {
  planKey: string;
  status: SubscriptionStatus;
  periodStart: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanKey: string | null;
}

export interface BillingData {
  subscription: SubscriptionData | null;
  open: PaymentData | null;
  payments: PaymentData[];
}

export interface PlanData {
  key: string;
  name: string;
  priceRs: number;
  limits: { stores: number | null; products: number | null; staffSeats: number | null; apiKeys: number | null; customDomain: boolean; premiumThemes: boolean };
  features: string[];
  sortOrder: number;
}

export interface InstructionsData {
  paymentInstructions: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
}

const isRecord = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isLimit = (value: unknown): value is number | null => value === null || isWhole(value);

function readPayment(value: unknown): PaymentData | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.planKey !== "string" || !isWhole(value.amountRs) || value.amountRs < 1) return null;
  if (!PAYMENT_STATUSES.includes(value.status as PaymentStatus) || typeof value.createdAt !== "string") return null;
  return {
    id: value.id,
    planKey: value.planKey,
    amountRs: value.amountRs,
    status: value.status as PaymentStatus,
    method: PAYMENT_METHODS.includes(value.method as PaymentMethod) ? (value.method as PaymentMethod) : null,
    reference: text(value.reference),
    proofUrl: text(value.proofUrl),
    periodEnd: text(value.periodEnd),
    reason: text(value.reason),
    createdAt: value.createdAt,
    claimedAt: text(value.claimedAt),
    decidedAt: text(value.decidedAt),
  };
}

/** The answer of GET /api/dashboard/subscription. Null for anything unusable: the page then says it could not load, and shows nothing wrong. */
export function readBilling(body: unknown): BillingData | null {
  if (!isRecord(body) || !Array.isArray(body.payments)) return null;
  let subscription: SubscriptionData | null = null;
  if (body.subscription !== null && body.subscription !== undefined) {
    const s = body.subscription;
    if (!isRecord(s) || typeof s.planKey !== "string" || !["trial", "active", "grace", "expired", "cancelled"].includes(s.status)) return null;
    subscription = {
      planKey: s.planKey,
      status: s.status,
      periodStart: text(s.periodStart),
      currentPeriodEnd: text(s.currentPeriodEnd),
      graceUntil: text(s.graceUntil),
      trialEndsAt: text(s.trialEndsAt),
      cancelAtPeriodEnd: s.cancelAtPeriodEnd === true,
      pendingPlanKey: text(s.pendingPlanKey),
    };
  }
  const payments = body.payments.map(readPayment);
  if (payments.some((payment) => payment === null)) return null;
  const open = body.open === null || body.open === undefined ? null : readPayment(body.open);
  if (body.open !== null && body.open !== undefined && open === null) return null;
  return { subscription, open, payments: payments as PaymentData[] };
}

/** The answer of GET /api/dashboard/subscription/instructions. */
export function readInstructions(body: unknown): InstructionsData | null {
  if (!isRecord(body)) return null;
  return { paymentInstructions: text(body.paymentInstructions), supportEmail: text(body.supportEmail), supportPhone: text(body.supportPhone) };
}

/** The answer of GET /api/dashboard/plans, cheapest first (then by the operator's order). Unusable plans are left out. */
export function readPlans(body: unknown): PlanData[] {
  if (!isRecord(body) || !Array.isArray(body.plans)) return [];
  const plans: PlanData[] = [];
  for (const raw of body.plans) {
    if (!isRecord(raw) || typeof raw.key !== "string" || typeof raw.name !== "string" || !isWhole(raw.priceRs) || !isRecord(raw.limits)) continue;
    const l = raw.limits;
    if (![l.stores, l.products, l.staffSeats, l.apiKeys].every(isLimit)) continue;
    plans.push({
      key: raw.key,
      name: raw.name,
      priceRs: raw.priceRs,
      limits: { stores: l.stores, products: l.products, staffSeats: l.staffSeats, apiKeys: l.apiKeys, customDomain: l.customDomain === true, premiumThemes: l.premiumThemes === true },
      features: Array.isArray(raw.features) ? raw.features.filter((feature: unknown): feature is string => typeof feature === "string") : [],
      sortOrder: isWhole(raw.sortOrder) ? raw.sortOrder : 0,
    });
  }
  return plans.sort((a, b) => a.priceRs - b.priceRs || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates and money

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Dec 2026", in UTC, so the server and the browser print the same day. An unusable date is an empty string. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.getUTCDate() + " " + MONTHS[date.getUTCMonth()] + " " + date.getUTCFullYear();
}

/** "Rs. 2,500 / month" (whole rupees); a free plan is "Free". */
export function priceText(priceRs: number): string {
  return priceRs === 0 ? "Free" : "Rs. " + priceRs.toLocaleString("en-US") + " / month";
}

/** A limit as the plan card says it: null is unlimited. */
export function limitText(label: string, value: number | null): string {
  return value === null ? "Unlimited " + label : value + " " + label;
}

/** The lines of a plan card's list. */
export function planFeatureLines(plan: Pick<PlanData, "limits">): string[] {
  const l = plan.limits;
  const lines = [limitText(l.stores === 1 ? "store" : "stores", l.stores), limitText("products per store", l.products)];
  if (l.staffSeats !== null && l.staffSeats > 0) lines.push(l.staffSeats + " staff seats");
  if (l.staffSeats === null) lines.push("Unlimited staff seats");
  if (l.customDomain) lines.push("Custom domain");
  if (l.premiumThemes) lines.push("Premium themes");
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan in force and what each plan card offers

/** The plan key whose limits apply at `now`, from the stored subscription (the server decides the same from the same dates). */
export function currentPlanKey(sub: SubscriptionData | null, now: Date): string {
  if (sub === null) return "free";
  const t = now.getTime();
  const end = sub.currentPeriodEnd === null ? null : new Date(sub.currentPeriodEnd).getTime();
  const trialEnd = sub.trialEndsAt === null ? null : new Date(sub.trialEndsAt).getTime();
  switch (sub.status) {
    case "trial":
      return trialEnd !== null && t < trialEnd ? sub.planKey : "free";
    case "active":
      return end === null || t < end || sub.cancelAtPeriodEnd !== true ? sub.planKey : "free";
    case "grace":
      return sub.planKey;
    case "cancelled":
      return end !== null && t < end ? sub.planKey : "free";
    default:
      return "free";
  }
}

export type PlanAction = "current" | "upgrade" | "downgrade";

/** What a plan card offers relative to the plan in force: cheaper is a downgrade (from the period end), dearer an upgrade. */
export function planAction(plan: Pick<PlanData, "key" | "priceRs">, current: Pick<PlanData, "key" | "priceRs"> | null): PlanAction {
  const currentPrice = current === null ? 0 : current.priceRs;
  const currentKey = current === null ? "free" : current.key;
  if (plan.key === currentKey) return "current";
  return plan.priceRs > currentPrice ? "upgrade" : "downgrade";
}

/** True when the plan in force should be renewed soon: payment due (grace), or a running period ending within 7 days and not set to end. */
export function renewalDue(sub: SubscriptionData | null, now: Date): boolean {
  if (sub === null) return false;
  if (sub.status === "grace") return true;
  if (sub.status !== "active" || sub.currentPeriodEnd === null || sub.cancelAtPeriodEnd) return false;
  const left = new Date(sub.currentPeriodEnd).getTime() - now.getTime();
  return left > 0 && left <= 7 * 86_400_000;
}

/** The lines under the plan's name: the period, a downgrade that is waiting, a cancel that is waiting. */
export function subscriptionLines(sub: SubscriptionData | null, planName: (key: string) => string): string[] {
  if (sub === null) return ["You are on the Free plan."];
  const name = planName(sub.planKey);
  const lines: string[] = [];
  const end = formatDate(sub.currentPeriodEnd);
  switch (sub.status) {
    case "trial":
      lines.push(name + " plan, free trial until " + formatDate(sub.trialEndsAt) + ". Pay to keep it.");
      break;
    case "active":
      lines.push(end === "" ? name + " plan." : name + " plan, paid until " + end + ".");
      break;
    case "grace":
      lines.push(name + " plan: your period ended on " + end + ". Pay by " + formatDate(sub.graceUntil) + " to keep it.");
      break;
    case "cancelled":
      lines.push(name + " plan, cancelled. It stays until " + end + ".");
      break;
    default:
      lines.push("Your " + name + " plan has ended. You are on the Free plan's limits; nothing was deleted.");
  }
  if (sub.cancelAtPeriodEnd && sub.status === "active") lines.push("It will end on " + end + ", and then the Free plan's limits apply.");
  if (sub.pendingPlanKey !== null && sub.status === "active") lines.push("It moves to the " + planName(sub.pendingPlanKey) + " plan on " + end + ".");
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// Payments

const STATUS_LABELS: Record<PaymentStatus, string> = {
  requested: "Waiting for your payment",
  claimed: "Being checked",
  confirmed: "Confirmed",
  rejected: "Not accepted",
  void: "Cancelled",
};

export const paymentStatusLabel = (status: PaymentStatus): string => STATUS_LABELS[status];

export type StatusTone = "default" | "secondary" | "destructive" | "outline";
export function paymentStatusTone(status: PaymentStatus): StatusTone {
  return status === "confirmed" ? "default" : status === "claimed" ? "secondary" : status === "rejected" ? "destructive" : "outline";
}

export const methodLabel = (method: PaymentMethod | null): string => PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? "";

/** What the open payment asks of the seller: pay and say so, or wait. */
export function openStep(open: PaymentData | null): "pay" | "wait" | null {
  return open === null ? null : open.status === "requested" ? "pay" : open.status === "claimed" ? "wait" : null;
}

export interface ClaimForm {
  method: PaymentMethod | "";
  reference: string;
  proofUrl: string;
}

export type ClaimProblems = Partial<Record<"method" | "reference" | "proofUrl", string>>;

/** The same checks the server makes (contracts/subscription-payments), so a form can say what is wrong before it is sent. */
export function claimProblems(form: ClaimForm): ClaimProblems {
  const problems: ClaimProblems = {};
  if (form.method === "") problems.method = "Choose how you paid.";
  const reference = form.reference.trim();
  if (reference === "") problems.reference = "Enter the transfer reference.";
  else if (reference.length > REFERENCE_MAX) problems.reference = "The reference can be at most " + REFERENCE_MAX + " characters.";
  else if (/[<>]/.test(reference)) problems.reference = "Use plain text: < and > are not allowed.";
  const proof = form.proofUrl.trim();
  if (proof !== "") {
    if (proof.length > PROOF_URL_MAX) problems.proofUrl = "The link can be at most " + PROOF_URL_MAX + " characters.";
    else if (!/^https:\/\/[^\s<>"']+$/i.test(proof)) problems.proofUrl = "The proof must be an https link.";
  }
  return problems;
}

/** The body of POST /api/dashboard/subscription/payments/claim: trimmed, and no proof link when it is blank. Never an amount: the server has it. */
export function claimBody(paymentId: string, form: ClaimForm): { paymentId: string; method: PaymentMethod; reference: string; proofUrl?: string } {
  const proof = form.proofUrl.trim();
  return { paymentId, method: form.method as PaymentMethod, reference: form.reference.trim(), ...(proof === "" ? {} : { proofUrl: proof }) };
}

/** The admin's payment instructions as lines of plain text (blank lines dropped). The page renders each as a text node: React escapes it. */
export function instructionLines(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// ---------------------------------------------------------------------------------------------------------------------
// Answers of the proxy

export interface ProxyProblem {
  message: string;
  code: string | null;
  field: string | null;
  /** One line per limit a refused downgrade would break. */
  exceeds: string[];
}

const EXCEEDS_LABELS: Record<string, string> = { stores: "Stores", products: "Products in a store", staffSeats: "Staff seats in a store", apiKeys: "API keys in a store" };

/** Reads a proxy error ({ error, code, field?, details? }) into what the page shows. */
export function readProblem(body: unknown, fallback: string): ProxyProblem {
  const r = isRecord(body) ? body : {};
  const exceeds =
    r.code === "DOWNGRADE_EXCEEDS_LIMITS" && Array.isArray(r.details)
      ? r.details
          .filter((entry: unknown) => isRecord(entry) && typeof entry.limit === "string" && isWhole(entry.allowed) && isWhole(entry.used))
          .map((entry: Record<string, any>) => (EXCEEDS_LABELS[entry.limit] ?? entry.limit) + ": the plan allows " + entry.allowed + " and you have " + entry.used + ".")
      : [];
  return { message: text(r.error) ?? fallback, code: text(r.code), field: text(r.field), exceeds };
}

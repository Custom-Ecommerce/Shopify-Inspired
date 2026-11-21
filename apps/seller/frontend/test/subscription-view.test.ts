import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimBody,
  claimProblems,
  currentPlanKey,
  formatDate,
  instructionLines,
  limitText,
  methodLabel,
  openStep,
  paymentStatusLabel,
  paymentStatusTone,
  planAction,
  planFeatureLines,
  priceText,
  readBilling,
  readInstructions,
  readPlans,
  readProblem,
  renewalDue,
  subscriptionLines,
  type SubscriptionData,
} from "../lib/subscription-view";

// Sprint 6 EP-14 (S6-B4, D-118): the billing page's pure helpers: what the page reads, says and checks. No I/O.

const NOW = new Date("2026-11-20T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number): string => new Date(NOW.getTime() + days * DAY).toISOString();

const payment = { id: "65a0000000000000000e0001", planKey: "growth", amountRs: 2500, status: "claimed", method: "jazzcash", reference: "TX-1", proofUrl: null, periodStart: null, periodEnd: null, reason: null, createdAt: at(-1), claimedAt: at(-1), decidedAt: null };
const subscription = { planKey: "growth", status: "active", periodStart: at(-10), currentPeriodEnd: at(20), graceUntil: null, trialEndsAt: null, cancelAtPeriodEnd: false, pendingPlanKey: null, source: "manual" };
const names = (key: string): string => ({ growth: "Growth", starter: "Starter", free: "Free" })[key] ?? key;

const sub = (overrides: Partial<SubscriptionData> = {}): SubscriptionData => ({ ...(subscription as SubscriptionData), ...overrides });

test("the billing answer is read, and anything unusable is null (the page says it could not load)", () => {
  const billing = readBilling({ subscription, open: payment, payments: [payment] })!;
  assert.deepEqual([billing.subscription?.planKey, billing.open?.status, billing.payments.length], ["growth", "claimed", 1]);
  assert.deepEqual(readBilling({ subscription: null, open: null, payments: [] }), { subscription: null, open: null, payments: [] });
  for (const bad of [null, "x", {}, { payments: "no" }, { subscription: { planKey: 5 }, open: null, payments: [] }, { subscription: { ...subscription, status: "paused" }, open: null, payments: [] }, { subscription: null, open: { ...payment, amountRs: 12.5 }, payments: [] }, { subscription: null, open: null, payments: [{ ...payment, status: "paid" }] }, { subscription: null, open: null, payments: [{ ...payment, amountRs: 0 }] }]) {
    assert.equal(readBilling(bad), null, JSON.stringify(bad).slice(0, 60));
  }
});

test("the payment instructions are read as plain text, and blanks are null", () => {
  assert.deepEqual(readInstructions({ paymentInstructions: "Pay to IBAN 1", supportEmail: "a@b.test", supportPhone: "" }), { paymentInstructions: "Pay to IBAN 1", supportEmail: "a@b.test", supportPhone: null });
  assert.equal(readInstructions(null), null);
});

test("the plans are read cheapest first; a plan with fractional money or no limits is left out", () => {
  const limits = { stores: 3, products: null, staffSeats: 3, apiKeys: 3, customDomain: true, premiumThemes: false };
  const plans = readPlans({
    plans: [
      { key: "growth", name: "Growth", priceRs: 2500, limits, features: ["Priority support", 5], sortOrder: 2 },
      { key: "free", name: "Free", priceRs: 0, limits: { ...limits, stores: 1, products: 10 }, sortOrder: 1 },
      { key: "bad", name: "Bad", priceRs: 12.5, limits },
      { key: "nolimits", name: "No limits", priceRs: 10 },
    ],
  });
  assert.deepEqual(plans.map((plan) => plan.key), ["free", "growth"]);
  assert.deepEqual(plans[1]!.features, ["Priority support"]);
  assert.deepEqual(readPlans(null), []);
});

test("dates are UTC days, money is whole rupees, limits say unlimited for null", () => {
  assert.equal(formatDate("2026-12-20T23:59:00.000Z"), "20 Dec 2026");
  assert.equal(formatDate("2028-02-29T00:00:00.000Z"), "29 Feb 2028");
  assert.equal(formatDate(null), "");
  assert.equal(formatDate("not a date"), "");
  assert.equal(priceText(2500), "Rs. 2,500 / month");
  assert.equal(priceText(0), "Free");
  assert.equal(limitText("products", null), "Unlimited products");
  assert.equal(limitText("stores", 3), "3 stores");
  const lines = planFeatureLines({ limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes: false } });
  assert.deepEqual(lines, ["1 store", "10 products per store"]);
  assert.deepEqual(planFeatureLines({ limits: { stores: null, products: null, staffSeats: null, apiKeys: 0, customDomain: true, premiumThemes: true } }), ["Unlimited stores", "Unlimited products per store", "Unlimited staff seats", "Custom domain", "Premium themes"]);
});

test("the plan in force: none and expired are Free; trial, active and grace are the plan; cancelled only until its end", () => {
  assert.equal(currentPlanKey(null, NOW), "free");
  assert.equal(currentPlanKey(sub(), NOW), "growth");
  assert.equal(currentPlanKey(sub({ status: "expired" }), NOW), "free");
  assert.equal(currentPlanKey(sub({ status: "grace", currentPeriodEnd: at(-2), graceUntil: at(5) }), NOW), "growth");
  assert.equal(currentPlanKey(sub({ status: "trial", trialEndsAt: at(3) }), NOW), "growth");
  assert.equal(currentPlanKey(sub({ status: "trial", trialEndsAt: at(-1) }), NOW), "free");
  assert.equal(currentPlanKey(sub({ status: "cancelled", currentPeriodEnd: at(3) }), NOW), "growth");
  assert.equal(currentPlanKey(sub({ status: "cancelled", currentPeriodEnd: at(-3) }), NOW), "free");
  assert.equal(currentPlanKey(sub({ currentPeriodEnd: at(-1), cancelAtPeriodEnd: true }), NOW), "free", "set to end: no grace");
  assert.equal(currentPlanKey(sub({ currentPeriodEnd: at(-1) }), NOW), "growth", "the job has not moved it to grace yet");
});

test("a plan card offers upgrade when dearer, downgrade when cheaper, and marks the current plan", () => {
  const free = { key: "free", priceRs: 0 };
  const starter = { key: "starter", priceRs: 900 };
  const growth = { key: "growth", priceRs: 2500 };
  assert.deepEqual([planAction(growth, growth), planAction(starter, growth), planAction(free, growth), planAction(growth, starter)], ["current", "downgrade", "downgrade", "upgrade"]);
  assert.deepEqual([planAction(free, null), planAction(starter, null), planAction(growth, free)], ["current", "upgrade", "upgrade"]);
});

test("a renewal is due in grace and in the last 7 days of a period that is not set to end", () => {
  assert.equal(renewalDue(null, NOW), false);
  assert.equal(renewalDue(sub({ status: "grace" }), NOW), true);
  assert.equal(renewalDue(sub({ currentPeriodEnd: at(7) }), NOW), true);
  assert.equal(renewalDue(sub({ currentPeriodEnd: at(8) }), NOW), false);
  assert.equal(renewalDue(sub({ currentPeriodEnd: at(3), cancelAtPeriodEnd: true }), NOW), false, "they chose to leave");
  assert.equal(renewalDue(sub({ currentPeriodEnd: at(-1) }), NOW), false);
  assert.equal(renewalDue(sub({ status: "expired" }), NOW), false);
});

test("the plan card's lines say the period, a waiting downgrade and a waiting cancel", () => {
  assert.deepEqual(subscriptionLines(null, names), ["You are on the Free plan."]);
  const end = formatDate(at(20));
  assert.deepEqual(subscriptionLines(sub(), names), ["Growth plan, paid until " + end + "."]);
  assert.deepEqual(subscriptionLines(sub({ pendingPlanKey: "starter" }), names), ["Growth plan, paid until " + end + ".", "It moves to the Starter plan on " + end + "."]);
  assert.deepEqual(subscriptionLines(sub({ cancelAtPeriodEnd: true }), names), ["Growth plan, paid until " + end + ".", "It will end on " + end + ", and then the Free plan's limits apply."]);
  assert.match(subscriptionLines(sub({ status: "grace", currentPeriodEnd: at(-2), graceUntil: at(5) }), names)[0]!, /Pay by .* to keep it/);
  assert.match(subscriptionLines(sub({ status: "expired" }), names)[0]!, /nothing was deleted/);
  assert.match(subscriptionLines(sub({ status: "trial", trialEndsAt: at(3) }), names)[0]!, /free trial until/);
  assert.match(subscriptionLines(sub({ status: "cancelled" }), names)[0]!, /cancelled/);
});

test("a payment's status has a label and a tone; the open step is pay, wait or none", () => {
  assert.deepEqual((["requested", "claimed", "confirmed", "rejected", "void"] as const).map(paymentStatusLabel), ["Waiting for your payment", "Being checked", "Confirmed", "Not accepted", "Cancelled"]);
  assert.deepEqual((["requested", "claimed", "confirmed", "rejected", "void"] as const).map(paymentStatusTone), ["outline", "secondary", "default", "destructive", "outline"]);
  assert.equal(openStep(null), null);
  assert.equal(openStep(readBilling({ subscription: null, open: { ...payment, status: "requested" }, payments: [] })!.open), "pay");
  assert.equal(openStep(readBilling({ subscription: null, open: payment, payments: [] })!.open), "wait");
  assert.equal(methodLabel("jazzcash"), "JazzCash");
  assert.equal(methodLabel(null), "");
});

test("the I-paid form says what is wrong before it is sent, with the same rules as the server", () => {
  assert.deepEqual(claimProblems({ method: "bank", reference: "TX-1", proofUrl: "" }), {});
  assert.deepEqual(claimProblems({ method: "", reference: "", proofUrl: "" }), { method: "Choose how you paid.", reference: "Enter the transfer reference." });
  assert.equal(claimProblems({ method: "bank", reference: "   ", proofUrl: "" }).reference, "Enter the transfer reference.");
  assert.match(claimProblems({ method: "bank", reference: "x".repeat(101), proofUrl: "" }).reference ?? "", /at most 100/);
  assert.match(claimProblems({ method: "bank", reference: "<b>1</b>", proofUrl: "" }).reference ?? "", /plain text/);
  assert.equal(claimProblems({ method: "bank", reference: "1", proofUrl: "https://example.com/slip.jpg" }).proofUrl, undefined);
  for (const proof of ["http://example.com/a.jpg", "javascript:alert(1)", "ftp://x.test", "//example.com", "https://a b.test"]) assert.equal(claimProblems({ method: "bank", reference: "1", proofUrl: proof }).proofUrl, "The proof must be an https link.", proof);
  assert.match(claimProblems({ method: "bank", reference: "1", proofUrl: "https://" + "x".repeat(300) }).proofUrl ?? "", /at most 300/);
});

test("the I-paid body is trimmed, carries no amount, and leaves the proof out when it is blank", () => {
  const id = "65a0000000000000000e0001";
  assert.deepEqual(claimBody(id, { method: "jazzcash", reference: "  TX-77812 ", proofUrl: "  " }), { paymentId: id, method: "jazzcash", reference: "TX-77812" });
  const full = claimBody(id, { method: "bank", reference: "R", proofUrl: " https://example.com/s.jpg " });
  assert.deepEqual(full, { paymentId: id, method: "bank", reference: "R", proofUrl: "https://example.com/s.jpg" });
  assert.equal("amountRs" in full, false);
});

test("payment instructions become lines of plain text; markup stays text for React to escape", () => {
  assert.deepEqual(instructionLines("Pay to <b>IBAN</b>\r\n\r\n  PK00 & <script>alert(1)</script>  \nThanks"), ["Pay to <b>IBAN</b>", "PK00 & <script>alert(1)</script>", "Thanks"]);
  assert.deepEqual(instructionLines(null), []);
  assert.deepEqual(instructionLines("   \n  "), []);
});

test("a refused downgrade is read into one line per limit; any other error keeps its message, code and field", () => {
  const problem = readProblem(
    { error: "You cannot move to the Starter plan yet.", code: "DOWNGRADE_EXCEEDS_LIMITS", details: [{ limit: "stores", allowed: 2, used: 3 }, { limit: "products", allowed: 100, used: 120 }, { limit: "bogus" }] },
    "Could not change the plan.",
  );
  assert.deepEqual(problem.exceeds, ["Stores: the plan allows 2 and you have 3.", "Products in a store: the plan allows 100 and you have 120."]);
  assert.equal(problem.code, "DOWNGRADE_EXCEEDS_LIMITS");
  assert.deepEqual(readProblem({ error: "Enter the transfer reference.", code: "ACCOUNT_BODY_INVALID", field: "reference" }, "x"), { message: "Enter the transfer reference.", code: "ACCOUNT_BODY_INVALID", field: "reference", exceeds: [] });
  assert.deepEqual(readProblem(null, "Could not save."), { message: "Could not save.", code: null, field: null, exceeds: [] });
  assert.deepEqual(readProblem({ code: "DOWNGRADE_EXCEEDS_LIMITS", details: [{ message: "x" }] }, "f").exceeds, []);
});

/*
 * Checks for Stiletto's checkout form and order page: each message lands on the box the shopper can fix, the boxes join into
 * what the store keeps, and the tab keeps no phone number. No test runner is needed. From themes/stiletto run:
 *
 *   npx tsx test/checkout-fields.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boxForField, firstErrorBox, stilettoFieldErrors, toCheckoutValues } from "../src/adapters/checkout-fields";
import type { StilettoCheckoutInput } from "../src/adapters/checkout-fields";
import { paymentSummary, readLastOrder, rememberLastOrder, whatHappensNext } from "../src/adapters/last-order";

const address = { firstName: "Sara", lastName: "Khan", address1: "House 12, Street 4", address2: "", city: "Karachi", zip: "" };

const input = (shipping: Partial<StilettoCheckoutInput["shippingAddress"]> = {}, rest: Partial<StilettoCheckoutInput> = {}): StilettoCheckoutInput => ({
  email: "",
  phone: "0300 1234567",
  sameOnWhatsapp: true,
  whatsapp: "",
  notes: "",
  shippingAddress: { ...address, ...shipping },
  ...rest,
});

const PHONE_MESSAGE = "Enter a valid mobile number, for example 0300 1234567";

const checks: Array<[string, () => void]> = [];
const check = (name: string, run: () => void): void => {
  checks.push([name, run]);
};

check("the form has no Country box: it was required but never sent", () => {
  const form = readFileSync(new URL("../src/components/checkout/checkout-section.tsx", import.meta.url), "utf8");
  assert.equal(form.includes("-country"), false, "no Country input");
  assert.equal(form.includes("Country *"), false, "no Country label");
  assert.equal("country" in address, false);
});

check("a complete form has no messages", () => {
  assert.deepEqual(stilettoFieldErrors(input()), {});
});

check("the boxes join into what the store keeps, with the city apart", () => {
  const values = toCheckoutValues(input({ address2: "Flat 3", zip: "75500" }, { notes: "Ring the bell", email: "sara@example.pk" }));
  assert.deepEqual(values, {
    customerName: "Sara Khan",
    phone: "0300 1234567",
    whatsapp: "",
    address: "House 12, Street 4, Flat 3, 75500",
    city: "Karachi",
    email: "sara@example.pk",
    note: "Ring the bell",
  });
});

check("with the box ticked, any number left in the WhatsApp field is not sent", () => {
  assert.equal(toCheckoutValues(input({}, { sameOnWhatsapp: true, whatsapp: "0311 7654321" })).whatsapp, "");
});

check("with the box unticked, the WhatsApp number is sent and required", () => {
  assert.equal(toCheckoutValues(input({}, { sameOnWhatsapp: false, whatsapp: "0311 7654321" })).whatsapp, "0311 7654321");
  assert.deepEqual(stilettoFieldErrors(input({}, { sameOnWhatsapp: false, whatsapp: "" })), { whatsapp: "Enter your WhatsApp number" });
  assert.deepEqual(stilettoFieldErrors(input({}, { sameOnWhatsapp: false, whatsapp: "99" })), { whatsapp: PHONE_MESSAGE });
  assert.deepEqual(stilettoFieldErrors(input({}, { sameOnWhatsapp: false, whatsapp: "0311 7654321" })), {});
});

check("each empty box says what is missing", () => {
  assert.deepEqual(stilettoFieldErrors(input({ firstName: "", lastName: "", address1: "", city: "" }, { phone: "" })), {
    firstName: "Enter your first name",
    lastName: "Enter your last name",
    phone: PHONE_MESSAGE,
    address1: "Enter your full delivery address",
    city: "Enter your city",
  });
});

check("a missing last name is not also reported as a bad full name", () => {
  assert.deepEqual(stilettoFieldErrors(input({ firstName: "S", lastName: "" })), { lastName: "Enter your last name" });
});

check("a wrong email and a too-long note are marked on their boxes", () => {
  assert.deepEqual(stilettoFieldErrors(input({}, { email: "nope" })), { email: "Enter a valid email address, or leave this empty" });
  assert.deepEqual(stilettoFieldErrors(input({}, { notes: "n".repeat(501) })), { notes: "Note is too long" });
});

check("Urdu digits are accepted in the phone box", () => {
  assert.deepEqual(stilettoFieldErrors(input({}, { phone: "۰۳۰۰ ۱۲۳۴۵۶۷" })), {});
});

check("a server refusal finds its box", () => {
  for (const [field, box] of [["customerName", "firstName"], ["phone", "phone"], ["whatsapp", "whatsapp"], ["email", "email"], ["address", "address1"], ["city", "city"], ["note", "notes"]] as const) {
    assert.equal(boxForField(field), box);
  }
  assert.equal(boxForField("shoeSize"), null);
});

check("the first message is the one highest on the page", () => {
  assert.equal(firstErrorBox({ city: "x", phone: "y" }), "phone");
  assert.equal(firstErrorBox({ notes: "x", lastName: "y" }), "lastName");
  assert.equal(firstErrorBox({}), null);
});

check("the order page says what is true about payment", () => {
  assert.deepEqual(paymentSummary({ paymentMethod: "card", paymentStatus: "paid", status: "pending" }), { method: "Card", state: "Paid" });
  assert.deepEqual(paymentSummary({ paymentMethod: "card", paymentStatus: "unpaid", status: "pending" }), { method: "Card", state: "Awaiting payment" });
  assert.deepEqual(paymentSummary({ paymentMethod: "card", paymentStatus: "unpaid", status: "cancelled" }), { method: "Card", state: "Payment not completed" });
  assert.deepEqual(paymentSummary({ paymentMethod: "cod", paymentStatus: "unpaid", status: "pending" }), { method: "Cash on Delivery", state: "Pay when it arrives" });
  assert.deepEqual(paymentSummary({ paymentMethod: "cod", paymentStatus: "collected", status: "delivered" }), { method: "Cash on Delivery", state: "Paid" });
});

check("what happens next depends on where the order stands", () => {
  assert.match(whatHappensNext({ paymentMethod: "cod", paymentStatus: "unpaid", status: "pending" }), /WhatsApp/);
  assert.match(whatHappensNext({ paymentMethod: "card", paymentStatus: "unpaid", status: "pending" }), /waiting/);
  assert.match(whatHappensNext({ paymentMethod: "card", paymentStatus: "unpaid", status: "cancelled" }), /cancelled/);
});

class TabStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const tab = new TabStorage();
(globalThis as unknown as { window: unknown }).window = { sessionStorage: tab };

check("the tab keeps only the order number and the token", () => {
  tab.values.clear();
  rememberLastOrder({ orderId: "ORD-1", accessToken: "tok", ...({ whatsapp: "03001234567", phone: "03001234567", total: 5 } as object) });
  assert.equal(tab.values.size, 1);
  const stored = [...tab.values.values()][0] as string;
  assert.deepEqual(JSON.parse(stored), { orderId: "ORD-1", accessToken: "tok" });
  assert.equal(/0300|923|whatsapp|phone/i.test(stored), false);
});

check("it reads back for its own order only, and survives a reload", () => {
  tab.values.clear();
  rememberLastOrder({ orderId: "ORD-1", accessToken: "tok" });
  assert.deepEqual(readLastOrder("ORD-1"), { orderId: "ORD-1", accessToken: "tok" });
  assert.equal(readLastOrder("ORD-2"), null);
});

check("what an earlier version stored, with its phone number, is removed", () => {
  tab.values.clear();
  tab.setItem("stiletto:last-order", JSON.stringify({ orderId: "ORD-1", total: 5, whatsapp: "03001234567" }));
  assert.equal(readLastOrder("ORD-1"), null);
  assert.equal(tab.getItem("stiletto:last-order"), null);
});

for (const [name, run] of checks) {
  run();
  console.log("ok - " + name);
}
console.log(checks.length + " checks passed");

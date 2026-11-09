/*
 * Checks for Stiletto's checkout form: each message lands on the box the shopper can fix, and the boxes join into what the
 * store keeps. No test runner is needed. From themes/stiletto run:
 *
 *   npx tsx test/checkout-fields.check.ts
 *
 * Exits non-zero on the first failing check.
 */
import assert from "node:assert/strict";
import { boxForField, firstErrorBox, stilettoFieldErrors, toCheckoutValues } from "../src/adapters/checkout-fields";
import type { StilettoCheckoutInput } from "../src/adapters/checkout-fields";

const input = (shipping: Partial<StilettoCheckoutInput["shippingAddress"]> = {}, rest: Partial<StilettoCheckoutInput> = {}): StilettoCheckoutInput => ({
  whatsapp: "0300 1234567",
  shippingAddress: { firstName: "Sara", lastName: "Khan", address1: "House 12, Street 4", address2: "", city: "Karachi", zip: "", phone: "", country: "Pakistan" },
  billingAddress: { firstName: "", lastName: "", address1: "", address2: "", city: "", zip: "", phone: "", country: "" },
  sameAsShipping: true,
  notes: "",
  ...rest,
  ...(Object.keys(shipping).length > 0 ? { shippingAddress: { firstName: "Sara", lastName: "Khan", address1: "House 12, Street 4", address2: "", city: "Karachi", zip: "", phone: "", country: "Pakistan", ...shipping } } : {}),
});

const checks: Array<[string, () => void]> = [];
const check = (name: string, run: () => void): void => {
  checks.push([name, run]);
};

check("a complete form has no messages, and the empty billing address does not matter", () => {
  assert.deepEqual(stilettoFieldErrors(input()), {});
});

check("the boxes join into one name, phone and address, with the city kept apart", () => {
  const values = toCheckoutValues(input({ address2: "Flat 3", zip: "75500" }, { notes: "Ring the bell" }));
  assert.deepEqual(values, {
    customerName: "Sara Khan",
    phone: "0300 1234567",
    address: "House 12, Street 4, Flat 3, 75500",
    city: "Karachi",
    email: "",
    note: "Ring the bell",
  });
});

check("each empty box says what is missing", () => {
  const errors = stilettoFieldErrors(input({ firstName: "", lastName: "", address1: "", city: "" }, { whatsapp: "" }));
  assert.deepEqual(errors, {
    firstName: "Enter your first name",
    lastName: "Enter your last name",
    whatsapp: "Enter a valid mobile number, for example 0300 1234567",
    address1: "Enter your full delivery address",
    city: "Enter your city",
  });
});

check("a missing last name is not also reported as a bad full name", () => {
  assert.deepEqual(stilettoFieldErrors(input({ firstName: "S", lastName: "" })), { lastName: "Enter your last name" });
});

check("a wrong WhatsApp number is marked on the WhatsApp box", () => {
  assert.deepEqual(stilettoFieldErrors(input({}, { whatsapp: "12345" })), { whatsapp: "Enter a valid mobile number, for example 0300 1234567" });
});

check("with WhatsApp empty the shipping phone is used, and a wrong one is marked there", () => {
  assert.equal(toCheckoutValues(input({ phone: "0311 7654321" }, { whatsapp: "" })).phone, "0311 7654321");
  assert.deepEqual(stilettoFieldErrors(input({ phone: "0311 7654321" }, { whatsapp: "" })), {});
  assert.deepEqual(stilettoFieldErrors(input({ phone: "99" }, { whatsapp: "" })), { phone: "Enter a valid mobile number, for example 0300 1234567" });
});

check("Urdu digits are accepted in the WhatsApp box", () => {
  assert.deepEqual(stilettoFieldErrors(input({}, { whatsapp: "۰۳۰۰ ۱۲۳۴۵۶۷" })), {});
});

check("a note that is too long is marked on the note box", () => {
  assert.deepEqual(stilettoFieldErrors(input({}, { notes: "n".repeat(501) })), { notes: "Note is too long" });
});

check("a server refusal finds its box, and a field the form has no box for has none", () => {
  assert.equal(boxForField("customerName", input()), "firstName");
  assert.equal(boxForField("phone", input()), "whatsapp");
  assert.equal(boxForField("address", input()), "address1");
  assert.equal(boxForField("city", input()), "city");
  assert.equal(boxForField("note", input()), "notes");
  assert.equal(boxForField("email", input()), null);
});

check("the first message is the one highest on the page", () => {
  assert.equal(firstErrorBox({ city: "x", whatsapp: "y" }), "whatsapp");
  assert.equal(firstErrorBox({ notes: "x", lastName: "y" }), "lastName");
  assert.equal(firstErrorBox({}), null);
});

for (const [name, run] of checks) {
  run();
  console.log("ok - " + name);
}
console.log(checks.length + " checks passed");

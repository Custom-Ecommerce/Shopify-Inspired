import { validateCheckout } from "@markaz/storefront-data";
import type { CheckoutValues } from "@markaz/storefront-data";
import type { AddressDetails } from "../model";

export interface StilettoCheckoutInput {
  whatsapp: string;
  shippingAddress: AddressDetails;
  billingAddress: AddressDetails;
  sameAsShipping: boolean;
  notes: string;
  /** Left out means cash on delivery. */
  paymentMethod?: "cod" | "card";
}

/** The boxes of Stiletto's form that can carry a message, top of the page first. */
export const STILETTO_CHECKOUT_FIELDS = ["whatsapp", "firstName", "lastName", "address1", "city", "phone", "notes"] as const;
export type StilettoCheckoutField = (typeof STILETTO_CHECKOUT_FIELDS)[number];
export type StilettoFieldErrors = Partial<Record<StilettoCheckoutField, string>>;

/** The form's boxes joined into what the store keeps: one name, one phone, one address and the city. */
export function toCheckoutValues(input: StilettoCheckoutInput): CheckoutValues {
  const a = input.shippingAddress;
  return {
    customerName: (a.firstName + " " + a.lastName).trim(),
    phone: input.whatsapp.trim() || a.phone,
    address: [a.address1, a.address2, a.zip].map((part) => (part ?? "").trim()).filter(Boolean).join(", "),
    city: a.city,
    email: "",
    note: input.notes,
  };
}

/** The box that holds the number being used. WhatsApp comes first; the shipping phone is used when WhatsApp is empty. */
function phoneBox(input: StilettoCheckoutInput): StilettoCheckoutField {
  return input.whatsapp.trim() === "" && input.shippingAddress.phone.trim() !== "" ? "phone" : "whatsapp";
}

/** Which box a refusal of a stored field belongs to. A field the form has no box for has no answer. */
export function boxForField(field: string, input: StilettoCheckoutInput): StilettoCheckoutField | null {
  switch (field) {
    case "customerName":
      return "firstName";
    case "phone":
      return phoneBox(input);
    case "address":
      return "address1";
    case "city":
      return "city";
    case "note":
      return "notes";
    default:
      return null;
  }
}

/**
 * Checks the form with the storefront's own rules, then puts each message on the box the shopper can fix. The form asks
 * for first and last name separately, so each of those says which one is missing.
 */
export function stilettoFieldErrors(input: StilettoCheckoutInput): StilettoFieldErrors {
  const errors: StilettoFieldErrors = {};
  const a = input.shippingAddress;
  if (a.firstName.trim() === "") errors.firstName = "Enter your first name";
  if (a.lastName.trim() === "") errors.lastName = "Enter your last name";

  const validation = validateCheckout(toCheckoutValues(input));
  if (validation.ok) return errors;

  for (const [field, message] of Object.entries(validation.errors)) {
    const box = boxForField(field, input);
    if (box !== null && errors[box] === undefined && !(box === "firstName" && errors.lastName !== undefined)) {
      errors[box] = message;
    }
  }
  return errors;
}

export function firstErrorBox(errors: StilettoFieldErrors): StilettoCheckoutField | null {
  return STILETTO_CHECKOUT_FIELDS.find((field) => errors[field] !== undefined) ?? null;
}

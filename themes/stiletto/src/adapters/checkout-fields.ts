import { validateCheckout } from "@markaz/storefront-data";
import type { CheckoutValues } from "@markaz/storefront-data";
import type { AddressDetails } from "../model";

export interface StilettoCheckoutInput {
  email: string;
  /** Used for delivery, and for WhatsApp updates unless the customer gives another number. */
  phone: string;
  sameOnWhatsapp: boolean;
  /** Read only when sameOnWhatsapp is off. */
  whatsapp: string;
  shippingAddress: AddressDetails;
  notes: string;
  /** Left out means cash on delivery. */
  paymentMethod?: "cod" | "card";
}

/** The boxes of Stiletto's form that can carry a message, top of the page first. */
export const STILETTO_CHECKOUT_FIELDS = ["email", "phone", "whatsapp", "firstName", "lastName", "address1", "city", "notes"] as const;
export type StilettoCheckoutField = (typeof STILETTO_CHECKOUT_FIELDS)[number];
export type StilettoFieldErrors = Partial<Record<StilettoCheckoutField, string>>;

/** The form's boxes joined into what the store keeps. */
export function toCheckoutValues(input: StilettoCheckoutInput): CheckoutValues {
  const a = input.shippingAddress;
  return {
    customerName: (a.firstName + " " + a.lastName).trim(),
    phone: input.phone,
    whatsapp: input.sameOnWhatsapp ? "" : input.whatsapp,
    address: [a.address1, a.address2, a.zip].map((part) => (part ?? "").trim()).filter(Boolean).join(", "),
    city: a.city,
    email: input.email,
    note: input.notes,
  };
}

/** Which box a refusal of a stored field belongs to. */
export function boxForField(field: string): StilettoCheckoutField | null {
  switch (field) {
    case "customerName":
      return "firstName";
    case "phone":
      return "phone";
    case "whatsapp":
      return "whatsapp";
    case "email":
      return "email";
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
  // Empty means "use the phone" to the server, but here the customer said it is a different number.
  if (!input.sameOnWhatsapp && input.whatsapp.trim() === "") errors.whatsapp = "Enter your WhatsApp number";

  const validation = validateCheckout(toCheckoutValues(input));
  if (validation.ok) return errors;

  for (const [field, message] of Object.entries(validation.errors)) {
    const box = boxForField(field);
    if (box !== null && errors[box] === undefined && !(box === "firstName" && errors.lastName !== undefined)) {
      errors[box] = message;
    }
  }
  return errors;
}

export function firstErrorBox(errors: StilettoFieldErrors): StilettoCheckoutField | null {
  return STILETTO_CHECKOUT_FIELDS.find((field) => errors[field] !== undefined) ?? null;
}

import { CHECKOUT_FIELDS, storefrontCheckoutCustomerSchema } from "@markaz/contracts/checkout";
import type { CheckoutCustomer, CheckoutField } from "@markaz/contracts/checkout";

export { CHECKOUT_FIELDS };
export type { CheckoutField };

/** What the form holds: every box as the shopper typed it. */
export interface CheckoutValues {
  customerName: string;
  phone: string;
  /** A WhatsApp number that differs from the phone. Empty means the phone is used. */
  whatsapp?: string;
  address: string;
  city: string;
  email?: string;
  note?: string;
}

export type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

export const EMPTY_CHECKOUT_VALUES: CheckoutValues = { customerName: "", phone: "", whatsapp: "", address: "", city: "", email: "", note: "" };

/** The guest checkout rules: the contract's schema, the same one the BFF and the seller backend run. */
export const checkoutFormSchema = storefrontCheckoutCustomerSchema;

/** What the server receives: the phone in E.164 and the text cleaned. */
export type CheckoutSubmission = CheckoutCustomer;

export type CheckoutValidation =
  | { ok: true; data: CheckoutSubmission }
  | { ok: false; errors: CheckoutFieldErrors };

function isCheckoutField(value: PropertyKey): value is CheckoutField {
  return (CHECKOUT_FIELDS as readonly PropertyKey[]).includes(value);
}

/** Validates the form. Keeps the first message per field, so each field shows one error. */
export function validateCheckout(values: CheckoutValues): CheckoutValidation {
  const result = checkoutFormSchema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: CheckoutFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field !== undefined && isCheckoutField(field) && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

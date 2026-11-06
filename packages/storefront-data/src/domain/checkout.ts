import { z } from "zod";
import { normalizePhoneE164 } from "@markaz/platform-kit/phone";

export const CHECKOUT_FIELDS = ["customerName", "phone", "address"] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

export interface CheckoutValues {
  customerName: string;
  phone: string;
  address: string;
}

export type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

export const EMPTY_CHECKOUT_VALUES: CheckoutValues = { customerName: "", phone: "", address: "" };

/**
 * Guest checkout rules. Pure, so the hook and the tests run the same code. The phone is
 * normalised to E.164 on the way out, so the server never sees local formats.
 */
export const checkoutFormSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(80, "Name is too long"),
  phone: z
    .string()
    .trim()
    .refine((value) => normalizePhoneE164(value) !== null, "Enter a valid mobile number, for example 0300 1234567")
    .transform((value) => normalizePhoneE164(value) ?? value),
  address: z
    .string()
    .trim()
    .min(10, "Enter your full delivery address")
    .max(300, "Address is too long"),
});

export type CheckoutSubmission = z.infer<typeof checkoutFormSchema>;

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

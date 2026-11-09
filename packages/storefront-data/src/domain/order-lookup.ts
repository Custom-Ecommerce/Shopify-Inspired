import { z } from "zod";
import { normalizePhoneE164 } from "@markaz/contracts/checkout";

export const ORDER_LOOKUP_FIELDS = ["orderId", "phone"] as const;
export type OrderLookupField = (typeof ORDER_LOOKUP_FIELDS)[number];

export interface OrderLookupValues {
  orderId: string;
  phone: string;
}

export type OrderLookupFieldErrors = Partial<Record<OrderLookupField, string>>;

export const EMPTY_ORDER_LOOKUP_VALUES: OrderLookupValues = { orderId: "", phone: "" };

/**
 * Order tracking rules. Order references are upper case, so the form accepts any case and sends the upper-case form.
 * The phone is normalised to E.164 here, the same way checkout does it, so the server compares like with like.
 */
export const orderLookupSchema = z.object({
  orderId: z
    .string()
    .trim()
    .min(1, "Enter your order reference")
    .max(40, "That order reference is too long")
    .transform((value) => value.toUpperCase()),
  phone: z
    .string()
    .trim()
    .refine((value) => normalizePhoneE164(value) !== null, "Enter the mobile number you ordered with")
    .transform((value) => normalizePhoneE164(value) ?? value),
});

export type OrderLookupSubmission = z.infer<typeof orderLookupSchema>;

export type OrderLookupValidation =
  | { ok: true; data: OrderLookupSubmission }
  | { ok: false; errors: OrderLookupFieldErrors };

function isLookupField(value: PropertyKey): value is OrderLookupField {
  return (ORDER_LOOKUP_FIELDS as readonly PropertyKey[]).includes(value);
}

/** Validates the lookup form. Keeps the first message per field, so each field shows one error. */
export function validateOrderLookup(values: OrderLookupValues): OrderLookupValidation {
  const result = orderLookupSchema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: OrderLookupFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field !== undefined && isLookupField(field) && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}

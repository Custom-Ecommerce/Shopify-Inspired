import { OrderRejectedError } from "../transport/errors";
import type { SubmitContactInput } from "../transport/types";

/**
 * Sprint 7 (S7-B4): the contact form's rules on the storefront side, pure so the themes share them and a check file can test them. The limits mirror
 * storeContactRequestSchema in @markaz/contracts; the seller backend checks them again and is the one that decides.
 */

export const CONTACT_LIMITS = { name: 100, email: 200, phone: 30, message: 3000, messageMin: 5 } as const;

export interface ContactFormValues {
  name: string;
  email: string;
  phone: string;
  message: string;
  consent: boolean;
  /** The honeypot. A person never sees it, so it is always empty for a person. */
  website: string;
}

export function emptyContactForm(): ContactFormValues {
  return { name: "", email: "", phone: "", message: "", consent: false, website: "" };
}

export type ContactFieldErrors = Partial<Record<"name" | "email" | "phone" | "message" | "consent", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9 ()-]{7,30}$/;

/** What is wrong with the form before anything is sent, by field. Empty when it can be sent. */
export function validateContactForm(values: ContactFormValues): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const phone = values.phone.trim();
  const message = values.message.trim();
  if (name === "") errors.name = "Enter your name.";
  else if (name.length > CONTACT_LIMITS.name) errors.name = "The name can be at most 100 characters.";
  if (email !== "" && (email.length > CONTACT_LIMITS.email || !EMAIL.test(email))) errors.email = "Enter a valid email address.";
  if (phone !== "" && !PHONE.test(phone)) errors.phone = "Enter a valid phone number.";
  if (email === "" && phone === "") errors.email = errors.email ?? "Give an email or a phone number so the store can answer.";
  if (message.length < CONTACT_LIMITS.messageMin) errors.message = "Write a message of at least 5 characters.";
  else if (message.length > CONTACT_LIMITS.message) errors.message = "The message can be at most 3000 characters.";
  if (!values.consent) errors.consent = "Please agree to be contacted.";
  return errors;
}

/** The input the transport sends: trimmed, empty optional fields left out. Only valid when validateContactForm found nothing. */
export function toContactInput(values: ContactFormValues): SubmitContactInput {
  return {
    name: values.name.trim(),
    email: values.email.trim() === "" ? null : values.email.trim(),
    phone: values.phone.trim() === "" ? null : values.phone.trim(),
    message: values.message.trim(),
    consent: true,
    website: values.website === "" ? null : values.website,
  };
}

export interface ContactFailure {
  message: string;
  /** The field the server named, when it did. */
  field?: string;
  /** Too many messages from this address: wait. */
  rateLimited?: boolean;
}

/** A sentence for the shopper when sending failed. A refusal the server explains keeps its words; anything else is "try again". */
export function contactFailure(error: unknown): ContactFailure {
  if (error instanceof OrderRejectedError) {
    const rejection = error.rejection;
    if (rejection.code === "rate_limited") return { message: "You have sent several messages already. Please wait a few minutes and try again.", rateLimited: true };
    if (rejection.code === "invalid_request") return { message: rejection.message, ...(rejection.field === undefined ? {} : { field: rejection.field }) };
    if (rejection.code === "store_inactive") return { message: "This store is not taking messages right now." };
  }
  return { message: "We could not send your message. Please check your connection and try again." };
}

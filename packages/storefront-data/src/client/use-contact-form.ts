"use client";

import { useCallback, useRef, useState } from "react";
import { contactFailure, emptyContactForm, toContactInput, validateContactForm } from "../domain/contact";
import type { ContactFieldErrors, ContactFormValues } from "../domain/contact";
import { TransportUnavailableError } from "../transport/errors";
import { useOrderTransport } from "./context";

export type ContactFormStatus = "idle" | "sending" | "sent" | "error";

export interface UseContactFormResult {
  status: ContactFormStatus;
  /** Problems the form can see itself, and the field a refusal named. */
  errors: ContactFieldErrors;
  /** A sentence for the shopper when sending failed. */
  message: string | null;
  /** Sends the message. Resolves true only when the store has kept it. */
  submit: (values: ContactFormValues) => Promise<boolean>;
  reset: () => void;
}

/**
 * Sprint 7 (S7-B4): the store's contact form, for every theme. The form is checked here first; the message goes to the same-origin BFF, which asks the seller
 * backend to store it. `sent` is reached ONLY when the store answered that it kept the message: a failure of any kind is `error` with a sentence, never a success.
 * A filled honeypot (`website`) is sent as it is: the server answers it like a success and keeps nothing.
 */
export function useContactForm(): UseContactFormResult {
  const transport = useOrderTransport();
  const [status, setStatus] = useState<ContactFormStatus>("idle");
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(
    async (values: ContactFormValues): Promise<boolean> => {
      if (inFlight.current) return false;
      const problems = validateContactForm(values);
      setErrors(problems);
      setMessage(null);
      if (Object.keys(problems).length > 0) {
        setStatus("error");
        return false;
      }
      if (!transport.submitContact) {
        setStatus("error");
        setMessage("This store cannot take messages right now.");
        return false;
      }
      inFlight.current = true;
      setStatus("sending");
      try {
        await transport.submitContact(toContactInput(values));
        setStatus("sent");
        return true;
      } catch (error) {
        const failure = contactFailure(error instanceof TransportUnavailableError ? new Error("unavailable") : error);
        setErrors(failure.field === "email" || failure.field === "phone" || failure.field === "name" || failure.field === "message" || failure.field === "consent" ? { [failure.field]: failure.message } : {});
        setMessage(failure.message);
        setStatus("error");
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [transport],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setErrors({});
    setMessage(null);
  }, []);

  return { status, errors, message, submit, reset };
}

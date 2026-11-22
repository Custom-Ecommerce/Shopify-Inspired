"use client";

import { useState, type FormEvent } from "react";
import { useContactForm } from "@markaz/storefront-data/client";
import { emptyContactForm } from "@markaz/storefront-data";
import type { ContactFormValues } from "@markaz/storefront-data";

/**
 * Sprint 7 (S7-B4): the store's contact form, shown on the contact page. Posts through the shared hook (useContactForm), which sends to the same-origin BFF.
 * The success message appears ONLY after the store has kept the message. The honeypot (`website`) is a field a person never sees: it is out of the layout,
 * out of the tab order and hidden from assistive technology.
 */
const FIELD = "block min-h-11 w-full rounded-lg border border-[var(--separator-border)] bg-transparent px-3 py-2 font-sans text-[15px] text-[var(--featured-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40";
const LABEL = "block font-sans text-[12px] uppercase tracking-[0.15em] text-[var(--featured-card-muted)] mb-2";
const ERROR = "mt-1 font-sans text-[12px] text-red-700";

export function ContactForm() {
  const { status, errors, message, submit, reset } = useContactForm();
  const [values, setValues] = useState<ContactFormValues>(() => emptyContactForm());
  const set = <K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (await submit(values)) setValues(emptyContactForm());
  }

  if (status === "sent") {
    return (
      <div role="status" data-testid="contact-sent" className="rounded-2xl border border-[var(--separator-border)] p-6 text-center font-sans text-[15px] text-[var(--featured-text)]">
        <p>Thank you. The store has received your message and will answer you soon.</p>
        <button type="button" onClick={reset} className="mt-4 inline-flex min-h-11 items-center underline underline-offset-4">
          Send another message
        </button>
      </div>
    );
  }

  const sending = status === "sending";
  return (
    <form onSubmit={onSubmit} noValidate aria-busy={sending} data-testid="contact-form" className="flex flex-col gap-5 rounded-2xl border border-[var(--separator-border)] p-5 md:p-8">
      <h2 className="font-heading text-[22px] md:text-[28px] uppercase text-[var(--featured-text)]">Write to the store</h2>

      <div>
        <label htmlFor="contact-name" className={LABEL}>Name</label>
        <input id="contact-name" name="name" autoComplete="name" value={values.name} onChange={(e) => set("name", e.target.value)} disabled={sending} className={FIELD} aria-invalid={Boolean(errors.name)} />
        {errors.name ? <p role="alert" className={ERROR}>{errors.name}</p> : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className={LABEL}>Email</label>
          <input id="contact-email" name="email" type="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} disabled={sending} className={FIELD} aria-invalid={Boolean(errors.email)} />
          {errors.email ? <p role="alert" className={ERROR}>{errors.email}</p> : null}
        </div>
        <div>
          <label htmlFor="contact-phone" className={LABEL}>Phone</label>
          <input id="contact-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} disabled={sending} className={FIELD} aria-invalid={Boolean(errors.phone)} />
          {errors.phone ? <p role="alert" className={ERROR}>{errors.phone}</p> : null}
        </div>
      </div>
      <p className="-mt-3 font-sans text-[12px] text-[var(--featured-card-muted)]">Give an email or a phone number so the store can answer.</p>

      <div>
        <label htmlFor="contact-message" className={LABEL}>Message</label>
        <textarea id="contact-message" name="message" rows={5} value={values.message} onChange={(e) => set("message", e.target.value)} disabled={sending} className={FIELD} aria-invalid={Boolean(errors.message)} />
        {errors.message ? <p role="alert" className={ERROR}>{errors.message}</p> : null}
      </div>

      {/* The honeypot: out of the layout, out of the tab order, hidden from assistive technology. A person never fills it. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="contact-website">Leave this field empty</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set("website", e.target.value)} data-testid="contact-honeypot" />
      </div>

      <label className="flex min-h-11 items-start gap-3 font-sans text-[14px] text-[var(--featured-text)]">
        <input type="checkbox" checked={values.consent} onChange={(e) => set("consent", e.target.checked)} disabled={sending} className="mt-1 size-5" />
        <span>I agree to be contacted about this message.</span>
      </label>
      {errors.consent ? <p role="alert" className={ERROR}>{errors.consent}</p> : null}

      {message ? <p role="alert" className="font-sans text-[14px] text-red-700">{message}</p> : null}

      <button type="submit" disabled={sending} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--surface-inverse)] px-8 font-sans text-[13px] font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-60">
        {sending ? "Sending..." : "Send message"}
      </button>
    </form>
  );
}

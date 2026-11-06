"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const FIELD =
  "mt-2 block h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";
const LABEL = "block text-sm font-medium text-foreground";

/**
 * Contact form. Posts the same JSON payload as before to /api/contact (route unchanged).
 * Success and error messages are announced through a live region.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const submitting = status.kind === "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Capture the form and its data before any await: event.currentTarget is cleared after dispatch.
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        form.reset();
        setStatus({ kind: "success", message: "Thanks. We have received your message." });
      } else {
        setStatus({ kind: "error", message: "We could not send your message. Please try again." });
      }
    } catch {
      setStatus({ kind: "error", message: "Something went wrong. Check your connection and try again." });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      aria-describedby="contact-status"
      className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 md:p-8"
    >
      <div>
        <label htmlFor="contact-name" className={LABEL}>
          Name
        </label>
        <input id="contact-name" name="name" type="text" autoComplete="name" required disabled={submitting} className={FIELD} />
      </div>

      <div>
        <label htmlFor="contact-email" className={LABEL}>
          Email
        </label>
        <input id="contact-email" name="email" type="email" autoComplete="email" required disabled={submitting} className={FIELD} />
      </div>

      <div>
        <label htmlFor="contact-topic" className={LABEL}>
          Topic
        </label>
        <select id="contact-topic" name="topic" disabled={submitting} className={FIELD}>
          <option>Sales inquiry</option>
          <option>Technical support</option>
          <option>Partnership</option>
          <option>Other</option>
        </select>
      </div>

      <div>
        <label htmlFor="contact-message" className={LABEL}>
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          required
          disabled={submitting}
          className="mt-2 block w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        />
      </div>

      {/* Honeypot: hidden from people and from keyboard focus. Bots tend to fill it in. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="contact-bot">Leave this field empty</label>
        <input id="contact-bot" name="bot-field" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" size="xl" className="w-full" disabled={submitting}>
        {submitting ? "Sending..." : "Send message"}
      </Button>

      <p
        id="contact-status"
        role={status.kind === "error" ? "alert" : "status"}
        aria-live="polite"
        className={
          status.kind === "error"
            ? "min-h-6 text-center text-sm font-medium text-destructive"
            : "min-h-6 text-center text-sm font-medium text-foreground"
        }
      >
        {status.kind === "success" || status.kind === "error" ? status.message : ""}
      </p>
    </form>
  );
}

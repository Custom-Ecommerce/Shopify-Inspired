"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { SUPPORT_LIMITS, createTicket, emptyTicketForm, ticketFormProblems, type TicketFormValues } from "@/lib/support";

/** Sprint 7 (S7-B4): open a support ticket. The form checks the same limits as the backend before it sends anything. */
export default function NewTicketPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const [values, setValues] = useState<TicketFormValues>(() => emptyTicketForm());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof TicketFormValues, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = ticketFormProblems(values);
    setProblems(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await createTicket(storeFetch, values);
    setBusy(false);
    if (!result.ok) {
      if (result.failure.field) setProblems({ [result.failure.field]: result.failure.message });
      else setFormError(result.failure.message);
      return;
    }
    toast.success("Ticket sent. The team will answer here and by email.");
    router.push(href(`/support/${result.value.id}`));
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="New ticket" description="Describe the problem. Include an order number if it is about an order." />
      <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-5" aria-busy={busy}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-subject">Subject</Label>
          <Input id="ticket-subject" className="min-h-11" value={values.subject} maxLength={SUPPORT_LIMITS.subject.max} disabled={busy} aria-invalid={Boolean(problems.subject)} onChange={(e) => set("subject", e.target.value)} />
          {problems.subject ? <p role="alert" className="text-sm text-destructive">{problems.subject}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-order">Order number (optional)</Label>
          <Input id="ticket-order" className="min-h-11" value={values.orderRef} maxLength={SUPPORT_LIMITS.orderRef} disabled={busy} aria-invalid={Boolean(problems.orderRef)} onChange={(e) => set("orderRef", e.target.value)} />
          {problems.orderRef ? <p role="alert" className="text-sm text-destructive">{problems.orderRef}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-message">Message</Label>
          <Textarea id="ticket-message" rows={7} value={values.message} maxLength={SUPPORT_LIMITS.message.max} disabled={busy} aria-invalid={Boolean(problems.message)} onChange={(e) => set("message", e.target.value)} />
          <p className="text-xs text-muted-foreground">Plain text. {values.message.length.toLocaleString()} / {SUPPORT_LIMITS.message.max.toLocaleString()}</p>
          {problems.message ? <p role="alert" className="text-sm text-destructive">{problems.message}</p> : null}
        </div>
        {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
        <Button type="submit" variant="clay" className="min-h-11 w-full sm:w-auto sm:self-start" disabled={busy}>
          {busy ? "Sending..." : "Send ticket"}
        </Button>
      </form>
    </div>
  );
}

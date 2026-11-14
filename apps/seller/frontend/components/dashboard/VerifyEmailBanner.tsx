"use client";

import { useState } from "react";
import { Loader2, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sprint 4 EP-08.US02.T02: shown on every dashboard page while the seller's email is not verified. The store can be
 * prepared, but going live and payouts wait for the verification (D-093). "Send the link again" is rate limited by the
 * backend (3 an hour).
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({ busy: false, message: null, error: false });

  async function resend() {
    setState({ busy: true, message: null, error: false });
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { sent?: unknown } | null;
        setState({ busy: false, error: false, message: data?.sent === false ? "Your email is already verified. Reload the page." : "Sent. Check your inbox." });
      } else if (res.status === 429) {
        setState({ busy: false, error: true, message: "You asked a few times already. Try again in an hour." });
      } else {
        setState({ busy: false, error: true, message: "Could not send the link. Try again." });
      }
    } catch {
      setState({ busy: false, error: true, message: "Could not reach the server. Try again." });
    }
  }

  return (
    <div role="status" className="flex flex-col gap-3 border-b border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 break-words">
          Verify your email <span className="font-medium">{email}</span> to put your store live and receive payouts.
          {state.message ? <span className={"ml-1 " + (state.error ? "text-destructive" : "font-medium")}>{state.message}</span> : null}
        </p>
      </div>
      <Button variant="outline" size="sm" className="min-h-9 shrink-0" onClick={resend} disabled={state.busy} aria-busy={state.busy}>
        {state.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Send the link again
      </Button>
    </div>
  );
}

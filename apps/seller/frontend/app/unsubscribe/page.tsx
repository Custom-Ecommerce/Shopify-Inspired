"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AccountCard, FormAlert, readApiError } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";

type State = { kind: "ask" } | { kind: "busy" } | { kind: "done" } | { kind: "invalid" } | { kind: "error"; message: string };

/**
 * EP-07.US04 (D-092): the page behind the unsubscribe link of a broadcast email. Public: the customer has no session. The
 * link is signed on the server; here it is only passed on. Nothing happens until the customer presses the button, so a mail
 * scanner that opens the link does not unsubscribe anyone. A link that is not valid says only that, never why.
 */
function Unsubscribe() {
  const params = useSearchParams();
  const store = params.get("s") ?? "";
  const email = params.get("e") ?? "";
  const sig = params.get("t") ?? "";
  const complete = store !== "" && email !== "" && sig !== "";
  const [state, setState] = useState<State>(complete ? { kind: "ask" } : { kind: "invalid" });

  async function confirm() {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, email, sig }),
      });
      if (res.ok) {
        setState({ kind: "done" });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "invalid" });
        return;
      }
      setState({ kind: "error", message: (await readApiError(res)).message });
    } catch {
      setState({ kind: "error", message: "Could not reach the server. Please try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <AccountCard eyebrow="Markazify" title="You are unsubscribed" intro="You will not get any more broadcast emails from this store. Emails about your own orders are not affected.">
        <p className="text-sm text-muted-foreground">You can close this page.</p>
      </AccountCard>
    );
  }
  if (state.kind === "invalid") {
    return (
      <AccountCard eyebrow="Markazify" title="This link is not valid" intro="Open the link from the email again, or copy the whole address into your browser.">
        <p className="text-sm text-muted-foreground">You can close this page.</p>
      </AccountCard>
    );
  }
  return (
    <AccountCard eyebrow="Markazify" title="Unsubscribe" intro="Stop getting broadcast emails from this store. Emails about your own orders will still reach you.">
      <div className="flex flex-col gap-4">
        {state.kind === "error" ? <FormAlert tone="error">{state.message}</FormAlert> : null}
        <Button variant="clay" size="lg" className="w-full" onClick={() => void confirm()} disabled={state.kind === "busy"} aria-busy={state.kind === "busy"}>
          {state.kind === "busy" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Unsubscribe me
        </Button>
      </div>
    </AccountCard>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <Unsubscribe />
    </Suspense>
  );
}

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AccountCard, FormAlert, readApiError } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";

type State =
  | { kind: "checking" }
  | { kind: "verified"; emailChange: boolean }
  | { kind: "expired" }
  | { kind: "taken" }
  | { kind: "error"; message: string };

/**
 * EP-08.US02.T01 / US04.T01: the link of the verification and the email-change emails. It works with or without a
 * session. An expired or used link shows a resend button (it needs a signed-in seller; without one the API answers 401
 * and the page says to sign in first).
 */
function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<State>(token === "" ? { kind: "expired" } : { kind: "checking" });
  const [resend, setResend] = useState<{ busy: boolean; message: string | null; tone: "success" | "error" }>({ busy: false, message: null, tone: "success" });
  const started = useRef(false);

  useEffect(() => {
    if (token === "" || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { kind?: unknown } | null;
          setState({ kind: "verified", emailChange: data?.kind === "email_change" });
          return;
        }
        const problem = await readApiError(res);
        if (problem.code === "TOKEN_INVALID") setState({ kind: "expired" });
        else if (problem.code === "EMAIL_TAKEN") setState({ kind: "taken" });
        else setState({ kind: "error", message: problem.message });
      } catch {
        setState({ kind: "error", message: "Could not reach the server. Please reload the page." });
      }
    })();
  }, [token]);

  async function sendAgain() {
    setResend({ busy: true, message: null, tone: "success" });
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { sent?: unknown } | null;
        setResend({ busy: false, tone: "success", message: data?.sent === false ? "Your email is already verified." : "A new link is on its way. Check your inbox." });
        return;
      }
      if (res.status === 401) {
        setResend({ busy: false, tone: "error", message: "Sign in first, then send the link again from your dashboard." });
        return;
      }
      setResend({ busy: false, tone: "error", message: (await readApiError(res)).message });
    } catch {
      setResend({ busy: false, tone: "error", message: "Could not reach the server. Please try again." });
    }
  }

  if (state.kind === "checking") {
    return (
      <AccountCard title="Checking your link…">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> One moment.
        </p>
      </AccountCard>
    );
  }

  if (state.kind === "verified") {
    return (
      <AccountCard
        title={state.emailChange ? "New email confirmed" : "Email verified"}
        intro={state.emailChange ? "Sign in with your new email from now on. Other devices were signed out." : "Thank you. You can put your store live once the checklist is complete."}
      >
        <Button render={<Link href="/" />} variant="clay" size="lg" className="w-full">
          Go to your dashboard
        </Button>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      title={state.kind === "taken" ? "This email is taken" : state.kind === "expired" ? "This link has expired" : "Something went wrong"}
      intro={
        state.kind === "taken"
          ? "Another account uses this email now. Choose a different one on your account page."
          : state.kind === "expired"
            ? "Links work once and for 24 hours. Send yourself a new one."
            : state.message
      }
    >
      <div className="flex flex-col gap-4">
        {resend.message ? <FormAlert tone={resend.tone}>{resend.message}</FormAlert> : null}
        {state.kind !== "taken" ? (
          <Button variant="clay" size="lg" className="w-full" onClick={sendAgain} disabled={resend.busy} aria-busy={resend.busy}>
            {resend.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Send a new verification link
          </Button>
        ) : null}
        <Button render={<Link href="/" />} variant="outline" size="lg" className="w-full">
          Go to your dashboard
        </Button>
      </div>
    </AccountCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}

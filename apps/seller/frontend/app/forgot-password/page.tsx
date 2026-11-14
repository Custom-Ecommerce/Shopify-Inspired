"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { AccountCard, FormAlert, readApiError } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** EP-08.US01.T03: ask for a reset link. The answer is the same whether or not the email has an account (D-093). */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFieldError("Enter the email address of your account.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const problem = await readApiError(res);
        if (problem.field === "email") setFieldError(problem.message);
        else setError(problem.message);
        return;
      }
      const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
      setSent(typeof data?.message === "string" ? data.message : "If an account exists for this email, we have sent a reset link.");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountCard title="Forgot your password?" intro="Enter your email and we will send you a link to choose a new one.">
      {sent ? (
        <div className="flex flex-col gap-5">
          <FormAlert tone="success">{sent}</FormAlert>
          <p className="text-sm text-muted-foreground">No email after a few minutes? Check your spam folder, or ask again.</p>
          <Button variant="clay" size="lg" className="w-full" onClick={() => setSent(null)}>
            Send another link
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 pl-10"
                aria-invalid={fieldError !== null}
                aria-describedby={fieldError ? "email-error" : undefined}
                required
              />
            </div>
            {fieldError ? (
              <p id="email-error" className="text-sm text-destructive">
                {fieldError}
              </p>
            ) : null}
          </div>
          {error ? <FormAlert tone="error">{error}</FormAlert> : null}
          <Button type="submit" variant="clay" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AccountCard>
  );
}

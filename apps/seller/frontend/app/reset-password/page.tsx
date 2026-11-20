"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { AccountCard, FormAlert, readApiError } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The shared rule (@markaz/contracts passwordSchema): 8 to 128 characters.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

type State = { kind: "form" } | { kind: "done" } | { kind: "expired" };

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<State>(token === "" ? { kind: "expired" } : { kind: "form" });
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: { password?: string; confirm?: string } = {};
    if (password.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (password.length > PASSWORD_MAX) errors.password = `Use at most ${PASSWORD_MAX} characters.`;
    if (confirm !== password) errors.confirm = "The two passwords are not the same.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setState({ kind: "done" });
        return;
      }
      const problem = await readApiError(res);
      if (problem.code === "TOKEN_INVALID") setState({ kind: "expired" });
      else if (problem.field === "password") setFieldErrors({ password: problem.message });
      else setError(problem.message);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "done") {
    return (
      <AccountCard title="Password changed" intro="Your new password works now. Every other device was signed out.">
        <Button render={<Link href="/login" />} variant="clay" size="lg" className="w-full">
          Sign in
        </Button>
      </AccountCard>
    );
  }

  if (state.kind === "expired") {
    return (
      <AccountCard title="This link has expired" intro="Reset links work once and for 30 minutes. Ask for a new one.">
        <Button render={<Link href="/forgot-password" />} variant="clay" size="lg" className="w-full">
          Send a new link
        </Button>
      </AccountCard>
    );
  }

  return (
    <AccountCard title="Choose a new password" intro="At least 8 characters. You will be signed out on every other device.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {(["password", "confirm"] as const).map((name) => (
          <div key={name} className="grid gap-1.5">
            <Label htmlFor={name}>{name === "password" ? "New password" : "Repeat the new password"}</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id={name}
                type="password"
                autoComplete="new-password"
                value={name === "password" ? password : confirm}
                onChange={(e) => (name === "password" ? setPassword(e.target.value) : setConfirm(e.target.value))}
                className="h-11 pl-10"
                maxLength={PASSWORD_MAX}
                aria-invalid={fieldErrors[name] !== undefined}
                aria-describedby={fieldErrors[name] ? name + "-error" : undefined}
                required
              />
            </div>
            {fieldErrors[name] ? (
              <p id={name + "-error"} className="text-sm text-destructive">
                {fieldErrors[name]}
              </p>
            ) : null}
          </div>
        ))}
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <Button type="submit" variant="clay" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Saving…" : "Save the new password"}
        </Button>
      </form>
    </AccountCard>
  );
}

/** EP-08.US01.T03. useSearchParams needs a Suspense boundary for the static prerender, as on /login. */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

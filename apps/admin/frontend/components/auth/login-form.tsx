"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MESSAGES: Record<number, string> = {
  401: "Invalid email or password.",
  422: "Enter a valid email address and password.",
  423: "This account is temporarily locked. Try again later.",
  429: "Too many attempts. Try again later.",
  503: "The admin service is unavailable. Try again shortly.",
};

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setError(MESSAGES[response.status] ?? "Sign-in failed. Try again.");
    } catch {
      setError("Could not reach the console. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full rounded-3xl border border-border bg-card p-6 shadow-lg sm:p-8">
      {notice ? (
        <p role="status" className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          {notice}
        </p>
      ) : null}

      <div className="mb-8">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Operator console</p>
        <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-foreground">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your admin account.</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="email" className="text-sm font-medium">
            Email
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@markazify.com"
              className="h-11 pl-10"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="h-11 pl-10 pr-11"
            />
            <button
              type="button"
              aria-pressed={showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <p id="login-error" role="alert" aria-live="polite" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="clay"
          size="lg"
          className="mt-1 w-full rounded-full shadow-lg shadow-primary/25"
          disabled={pending || email === "" || password === ""}
          aria-busy={pending}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin size-4" aria-hidden="true" />
              <span>Signing in…</span>
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">Authorised operators only.</p>
    </Card>
  );
}

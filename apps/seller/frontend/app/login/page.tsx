"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Surface } from "@/components/shared/Surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionBanner, setSessionBanner] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Blueprint §3.3: read ?error=unauthorized from middleware redirect
  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam === "unauthorized") {
      setSessionBanner("Your session expired. Please sign in again.");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data?.error ?? "Invalid email or password.");
        return;
      }

      // ── API contract unchanged ──
      router.push("/");
      router.refresh();
    } catch {
      setErrorMessage("Could not reach the backend. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthShell>
      <Surface
        variant="clay"
        level={4}
        radius="3xl"
        className="w-full p-6 sm:p-8"
      >
        {/* Session expiry banner */}
        {sessionBanner && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
          >
            {sessionBanner}
          </div>
        )}

        {/* Card header */}
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Seller Portal
          </p>
          <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your Markazify account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {/* Email */}
          <div className="grid gap-1.5">
            <Label htmlFor="email" className="text-sm font-medium">
              Email
            </Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                placeholder="name@markazify.com" onChange={(e) => setEmail(e.target.value)}
                className="h-11 pl-10"
                required
                aria-invalid={!!errorMessage}
              />
            </div>
          </div>

          {/* Password */}
          <div className="grid gap-1.5">
            <Label htmlFor="password" className="text-sm font-medium">
              Password
            </Label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                placeholder="••••••••" onChange={(e) => setPassword(e.target.value)}
                className="h-11 pl-10 pr-11"
                required
                aria-invalid={!!errorMessage}
              />
              <button
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Inline error */}
          {errorMessage && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {errorMessage}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="clay"
            size="lg"
            className="mt-1 w-full"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Signing in…</span>
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have a store yet?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Start selling
          </Link>
        </p>
      </Surface>
    </AuthShell>
  );
}

/**
 * `useSearchParams()` must sit under a Suspense boundary so Next can prerender
 * the page statically (missing-suspense-with-csr-bailout). The form itself is
 * unchanged; it is just rendered inside the boundary.
 */
export default function DashboardLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

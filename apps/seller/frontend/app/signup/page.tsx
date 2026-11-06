"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock, User, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Surface } from "@/components/shared/Surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Simple advisory strength: 0 = weak, 1 = fair, 2 = strong. */
function passwordStrength(pw: string): 0 | 1 | 2 {
  if (pw.length < 6) return 0;
  const checks = [/[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 10 && checks >= 2) return 2;
  if (pw.length >= 8 || checks >= 1) return 1;
  return 0;
}

const STRENGTH_LABEL = ["Weak", "Fair", "Strong"] as const;
const STRENGTH_COLOR = [
  "bg-destructive",
  "bg-warning",
  "bg-success",
] as const;

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Account only — the first store is created after login at /stores/new.
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data?.error ?? data?.message ?? "Signup failed.");
        return;
      }

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
        {/* Card header */}
        <div className="mb-4">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Seller Portal
          </p>
          <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-foreground">
            Start selling
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your account — you will set up your store next.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          {/* Name */}
          <div className="grid gap-1.5">
            <Label htmlFor="name" className="text-sm font-medium">
              Your Name
            </Label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                placeholder="John Doe" onChange={(e) => setName(e.target.value)}
                className="h-11 pl-10"
                required
              />
            </div>
          </div>

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
                autoComplete="new-password"
                value={password}
                placeholder="••••••••" onChange={(e) => setPassword(e.target.value)}
                className="h-11 pl-10 pr-11"
                required
                aria-invalid={!!errorMessage}
                aria-describedby="password-strength"
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

            {/* Strength indicator — advisory, client-only (blueprint §3.4) */}
            {password && (
              <div id="password-strength" className="flex items-center gap-2" aria-live="polite">
                <div className="flex flex-1 gap-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                        i <= strength ? STRENGTH_COLOR[strength] : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {STRENGTH_LABEL[strength]}
                </span>
              </div>
            )}
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
                <span>Creating account…</span>
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        {/* Trust row — blueprint §3.4 */}
        

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </Surface>
    </AuthShell>
  );
}

import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Surface } from "@/components/shared/Surface";

/** Sprint 4 EP-08: the card the forgot, reset and verify pages share, in the same shell and style as /login. */
export function AccountCard({ eyebrow = "Seller Portal", title, intro, children }: { eyebrow?: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <AuthShell>
      <Surface variant="clay" level={4} radius="3xl" className="w-full p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          {intro ? <p className="mt-1 text-sm text-muted-foreground">{intro}</p> : null}
        </div>
        {children}
      </Surface>
    </AuthShell>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const style =
    tone === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "success"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-border bg-muted/50 text-foreground";
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live="polite" className={`rounded-xl border px-4 py-3 text-sm ${style}`}>
      {children}
    </div>
  );
}

/** Reads { error, code, field } from a BFF error answer, and the wait from Retry-After on a 429. */
export async function readApiError(res: Response): Promise<{ message: string; code: string | null; field: string | null }> {
  const data = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown; field?: unknown } | null;
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after") ?? "0");
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return { message: `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`, code: "RATE_LIMITED", field: null };
  }
  return {
    message: typeof data?.error === "string" ? data.error : "Something went wrong. Please try again.",
    code: typeof data?.code === "string" ? data.code : null,
    field: typeof data?.field === "string" ? data.field : null,
  };
}

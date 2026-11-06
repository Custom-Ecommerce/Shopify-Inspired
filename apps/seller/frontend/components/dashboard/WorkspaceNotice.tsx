import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/shared/Surface";
import { isDashboardAuthError } from "@/lib/error-codes";

interface NoticeAction {
  label: string;
  href: string;
  /** Plain anchor (full navigation) instead of client-side `<Link>`. */
  hard?: boolean;
}

/**
 * Full-page notice for states where there is nothing to render underneath
 * (backend offline, account suspended, no access to a store). Server-safe.
 */
export function WorkspaceNotice({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: NoticeAction[];
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <Surface variant="clay" level={2} radius="2xl" className="flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warning/12 text-warning">
          <AlertTriangle className="size-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {actions.map((action, i) => (
              <Button
                key={action.href + action.label}
                variant={i === 0 ? "clay" : "clay-soft"}
                render={action.hard ? <a href={action.href} /> : <Link href={action.href} />}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </Surface>
    </main>
  );
}

/**
 * Turns an error thrown by the server-side auth helpers into the right
 * response (Blueprint §6.8): a redirect, or a notice view the caller returns.
 * Unknown errors are re-thrown so Next's error boundary handles them.
 *
 * Call it from a `catch` block (never from inside a `try`, which would swallow
 * the redirect): `catch (err) { return authFailureView(err); }`.
 */
export function authFailureView(err: unknown): ReactNode {
  if (!isDashboardAuthError(err)) throw err;

  switch (err.code) {
    case "UNAUTHENTICATED":
      return redirect("/login?clear=1");
    case "STORE_CONTEXT_REQUIRED":
      return redirect("/");
    case "NO_STORES":
      return redirect("/stores");
    case "STORE_FORBIDDEN":
      return (
        <WorkspaceNotice
          title="No access to this store"
          description="This store doesn't exist or isn't part of your account. Pick one of your own stores to continue."
          actions={[{ label: "Go to your stores", href: "/stores" }]}
        />
      );
    case "ACCOUNT_SUSPENDED":
      return (
        <WorkspaceNotice
          title="Your account is suspended"
          description="Access to the seller dashboard is blocked for this account. Contact Markazify support if you think this is a mistake."
          actions={[{ label: "Sign out", href: "/login?clear=1", hard: true }]}
        />
      );
    case "BACKEND_OFFLINE":
    default:
      return (
        <WorkspaceNotice
          title="Can't reach the server"
          description="The dashboard couldn't reach the backend. Check your connection and try again in a moment."
          actions={[{ label: "Try again", href: "/", hard: true }]}
        />
      );
  }
}

import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/BrandMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { AuthBackground } from "./AuthBackground";
import { AuthProofPanel } from "./AuthProofPanel";

/**
 * AuthShell: server component layout wrapper for /login and /signup.
 *
 * Blueprint §3.2 structure:
 *   AuthShell
 *   ├─ Background layer (aria-hidden, pointer-events-none, server-rendered)
 *   │   └─ AuthBackground (grid + cells + glow + light sweep)
 *   ├─ Top bar
 *   │   ├─ BrandMark (left)
 *   │   └─ ThemeToggle (right)
 *   ├─ Stage (h-dvh overflow-hidden, centered)
 *   │   ├─ AuthProofPanel (≥lg left column, aria-hidden, decorative)
 *   │   └─ {children} — the form card
 *
 * The form card itself is a Surface (level 4, rounded-3xl, flat Rose style)
 * rendered by each page component. AuthShell does not assume anything about
 * what goes inside the card slot — it just positions it.
 *
 * Server component: ThemeToggle is client but is a leaf — the shell itself
 * does not hydrate. AuthBackground uses no JS (CSS-only animations).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-dvh overflow-hidden overflow-hidden bg-background">
      {/* Decorative background — server-rendered, no JS */}
      <AuthBackground />

      {/* Top bar */}
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <BrandMark href="/" />
        <ThemeToggle />
      </header>

      {/* Main stage — split at lg */}
      <main className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-2 lg:px-8 lg:pt-0">
        {/* Left proof panel (lg+) */}
        <AuthProofPanel />

        {/* Right: form card — min 16px margin from edges at 320px */}
        <div className="flex w-full items-center justify-center lg:justify-end">
          <div className="w-full max-w-md">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

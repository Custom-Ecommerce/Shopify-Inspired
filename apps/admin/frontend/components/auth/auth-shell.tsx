import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/brand-mark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AuthBackground } from "./auth-background";
import { AuthProofPanel } from "./auth-proof-panel";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-dvh overflow-hidden bg-background">
      <AuthBackground />

      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <BrandMark />
        <ThemeToggle />
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-2 lg:px-8 lg:pt-0">
        <AuthProofPanel />

        <div className="flex w-full items-center justify-center lg:justify-end">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}

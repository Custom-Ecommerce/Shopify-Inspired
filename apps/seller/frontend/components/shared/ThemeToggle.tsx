"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * ThemeToggle: cycles light → dark → system.
 *
 * Blueprint §4.4: lives in the sticky TopBar (right side).
 * 44px touch target (min-h-11 min-w-11) required.
 *
 * Note: if the existing "Appearance" radio group in UserMenu is kept,
 * both controls will be live simultaneously — that is acceptable as a
 * duplicate affordance (blueprint §1.7).
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Fixed-size placeholder to prevent layout shift (w-11 h-11 matches the touch target)
    return <div className="h-11 w-11 shrink-0" aria-hidden="true" />;
  }

  return (
    <Button
      variant="ghost"
      className="min-h-11 min-w-11 shrink-0 p-0"
      onClick={() => {
        if (theme === "light") setTheme("dark");
        else if (theme === "dark") setTheme("system");
        else setTheme("light");
      }}
      aria-label={`Theme: ${theme}`}
    >
      {theme === "light" && <Sun className="size-5" />}
      {theme === "dark" && <Moon className="size-5" />}
      {theme === "system" && <Monitor className="size-5" />}
    </Button>
  );
}

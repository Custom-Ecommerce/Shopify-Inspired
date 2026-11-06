"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Fixed-size placeholder to prevent layout shift (w-11 h-11 matches our Button size for touch targets)
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
      {theme === "light" && <Sun className="size-5" aria-hidden="true" />}
      {theme === "dark" && <Moon className="size-5" aria-hidden="true" />}
      {theme === "system" && <Monitor className="size-5" aria-hidden="true" />}
    </Button>
  );
}

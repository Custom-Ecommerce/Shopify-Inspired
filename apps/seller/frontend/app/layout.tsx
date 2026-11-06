import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

/**
 * Font wiring (two layers, on purpose):
 *
 *  1. next/font exposes a RAW variable on <html>: --font-poppins.
 *  2. globals.css maps the design TOKENS onto it:
 *       --font-sans     -> Poppins
 *       --font-heading  -> Poppins  (Inspired UI uses one family everywhere)
 *
 * The raw variable must NOT share a name with the tokens. A token that points
 * at a variable of its own name is a self-reference; the browser treats it as
 * invalid and silently falls back to the system font.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: { default: "Markazify Seller Portal", template: "%s | Markazify" },
  description: "Manage your store on the Markazify platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(poppins.variable, "font-sans")} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

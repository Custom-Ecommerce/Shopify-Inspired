/* @markaz/storefront:phase1-flat-typography */
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/context/app-providers";
import { BRAND } from "@/lib/brand";
import { SITE_URL } from "@/lib/seo";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: `${BRAND.name}: Sell online in Pakistan`,
    template: `%s | ${BRAND.name}`,
  },
  description:
    "Markazify helps Pakistani sellers open an online store with Cash on Delivery, WhatsApp order checks, JazzCash and EasyPaisa.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={fontSans.variable}
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased selection:bg-primary/15 selection:text-primary">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

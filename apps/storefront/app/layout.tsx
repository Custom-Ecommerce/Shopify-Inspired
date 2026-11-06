/* @markaz/storefront:phase1-flat-typography */
import { AppProviders } from "@/context/app-providers";
import { BRAND } from "@/lib/brand";
import { SITE_URL } from "@/lib/seo";
import type { Metadata, Viewport } from "next";
import { Poppins, Roboto_Mono } from "next/font/google";
import "./globals.css";

const fontSans = Poppins({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const fontMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
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
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased selection:bg-primary/15 selection:text-primary">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

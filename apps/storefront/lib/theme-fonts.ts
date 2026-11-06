import { Bebas_Neue, Space_Mono } from "next/font/google";

// Stiletto's fonts, loaded exactly as the original app's root layout loaded them.
const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--custom-heading", display: "swap" });
const spaceMono = Space_Mono({ weight: ["400", "700"], subsets: ["latin"], variable: "--custom-sans", display: "swap" });

/** Font variable classes per scoped theme. Applied to <html> by ThemeScope so portalled drawers resolve them too. */
export const themeFonts: Record<string, string> = {
  stiletto: [bebas.variable, spaceMono.variable].join(" "),
};

/** The utility classes the original <html> element carried. */
export const themeHtmlClasses: Record<string, string> = {
  stiletto: "h-full antialiased font-sans",
};

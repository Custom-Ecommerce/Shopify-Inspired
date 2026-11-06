import { themeFonts, themeHtmlClasses } from "@/lib/theme-fonts";

/** Themes whose stylesheet is scoped to html[data-theme="<slug>"]. Mustafa scopes itself with a wrapper element. */
export const SCOPED_THEMES: ReadonlySet<string> = new Set(Object.keys(themeFonts));

/**
 * Sets the scope attribute (and the theme's font classes) on <html> before first paint. <html> is used instead of a
 * wrapper element because Radix portals and body rules live outside any wrapper. Renders nothing for unscoped themes.
 */
export function ThemeScope({ slug }: { slug: string }) {
  if (!SCOPED_THEMES.has(slug)) return null;
  const classes = [themeHtmlClasses[slug], themeFonts[slug]].filter(Boolean).join(" ").split(" ").filter(Boolean);
  const code =
    "(function(){var d=document.documentElement;d.setAttribute('data-theme'," +
    JSON.stringify(slug) +
    ");d.classList.add.apply(d.classList," +
    JSON.stringify(classes) +
    ");})();";
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

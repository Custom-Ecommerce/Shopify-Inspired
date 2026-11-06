import { PageHeader } from "@/components/marketing/layout/page-header";
import { ThemeCard } from "@/components/marketing/themes/theme-card";
import { ClosingCta } from "@/components/marketing/cta/closing-cta";
import { THEMES } from "@/content/marketing/themes";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Themes",
  description:
    "Choose a theme for your Markazify store. Open a live demo on your phone, see how each theme looks, then pick the one that fits your brand.",
  path: "/themes",
});

export default function ThemesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Themes"
        title="Themes for your brand"
        lead="Open a live demo of any theme on your phone before you choose it for your store."
      />

      <div className="mx-auto w-full max-w-7xl px-4 pb-(--section-y) sm:px-6 lg:px-8">
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((theme, i) => (
            <li key={theme.id} className="flex">
              <ThemeCard theme={theme} index={i} headingTag="h2" />
            </li>
          ))}
        </ul>
      </div>

      <ClosingCta />
    </>
  );
}

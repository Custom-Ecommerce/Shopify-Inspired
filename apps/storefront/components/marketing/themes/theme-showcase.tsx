import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { Reveal } from "@/components/shared/reveal";
import { ViewAllLink } from "@/components/shared/view-all-link";
import { THEMES } from "@/content/marketing/themes";
import { ThemeCard } from "./theme-card";

/** The homepage shows the top four themes at most; /themes has the full set. */
const FEATURED_THEMES = THEMES.slice(0, 4);

export function ThemeShowcase() {
  return (
    <Section id="themes" labelledBy="themes-heading">
      <div className="flex flex-col items-center">
        <SectionHeading
          id="themes-heading"
          eyebrow="Themes"
          title="Themes for your brand"
          lead="Open a live demo store on your phone to see how each theme looks before you choose one."
          align="center"
        />

        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURED_THEMES.map((theme, i) => (
            <ThemeCard key={theme.id} theme={theme} index={i} />
          ))}
        </div>

        <Reveal delay={200} className="mt-12">
          <ViewAllLink href="/themes">View all themes</ViewAllLink>
        </Reveal>
      </div>
    </Section>
  );
}

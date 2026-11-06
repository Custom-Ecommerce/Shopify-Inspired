import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/shared/card";
import { Reveal } from "@/components/shared/reveal";
import { staggerDelay } from "@/components/shared/motion";
import type { ThemeItem } from "@/content/marketing/themes";
import { getThemeDemoUrl } from "@/lib/urls";
import { ThemeDeviceStack } from "./theme-device-stack";

const LINK =
  "inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Flat theme card, used on the home page and on /themes. It shows the real screenshot when
 * the theme has one in content/marketing/themes.ts, otherwise the device mockup. Two links:
 * the live demo (new tab) and the theme's detail page.
 */
export function ThemeCard({
  theme,
  index = 0,
  headingTag = "h3",
}: {
  theme: ThemeItem;
  index?: number;
  headingTag?: "h2" | "h3";
}) {
  const demoUrl = getThemeDemoUrl(theme.id);
  const tierLabel = theme.tier === "free" ? "Free" : "Premium";
  const Heading = headingTag;

  return (
    <Reveal delay={100 + staggerDelay(index)} className="flex h-full">
      <Card
        as="article"
        variant="interactive"
        padding="none"
        aria-labelledby={`theme-${theme.id}-title`}
        className="group/theme flex h-full w-full flex-col gap-5 p-4"
      >
        <div aria-hidden="true" className="relative rounded-md border border-border bg-surface-2 p-6">
          {theme.screenshot ? (
            <>
              <Image
                src={theme.screenshot.desktop}
                alt=""
                width={1280}
                height={800}
                sizes="(min-width: 1024px) 30vw, 90vw"
                className="aspect-[4/5] h-auto w-full rounded-lg border border-border object-cover object-top motion-safe:transition-[object-position] motion-safe:duration-[3.5s] motion-safe:ease-in-out motion-safe:group-hover/theme:object-bottom motion-safe:group-has-[:focus-visible]/theme:object-bottom"
              />
              {theme.screenshot.mobile && (
                <Image
                  src={theme.screenshot.mobile}
                  alt=""
                  width={390}
                  height={844}
                  sizes="24vw"
                  className="absolute -bottom-3 right-3 h-auto w-1/4 rounded-xl border border-border"
                />
              )}
            </>
          ) : (
            <ThemeDeviceStack id={theme.id} />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
          <div className="flex items-center justify-between gap-3">
            <Heading id={`theme-${theme.id}-title`} className="text-xl font-semibold tracking-tight text-foreground">
              {theme.name}
            </Heading>
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {tierLabel}
            </span>
          </div>
          <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{theme.description}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1">
            <a href={demoUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} group/demo`}>
              Live demo
              <span className="sr-only"> of the {theme.name} theme (opens in a new tab)</span>
              <ArrowUpRight
                className="size-4 text-muted-foreground transition-transform duration-150 group-hover/demo:translate-x-0.5 group-hover/demo:-translate-y-0.5 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </a>
            <Link href={`/themes/${theme.id}`} className={LINK}>
              View details
              <span className="sr-only"> for the {theme.name} theme</span>
            </Link>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

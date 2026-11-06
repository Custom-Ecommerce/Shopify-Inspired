import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { THEME_SLUGS, getThemeEntry } from "@markaz/platform-kit/themes";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/shared/container";
import { ViewAllLink } from "@/components/shared/view-all-link";
import { ThemeDeviceStack } from "@/components/marketing/themes/theme-device-stack";
import { toThemeItem } from "@/content/marketing/themes";
import { buildPageMetadata } from "@/lib/seo";
import { getSellerPortalUrl, getThemeDemoUrl } from "@/lib/urls";

export function generateStaticParams() {
  return THEME_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = getThemeEntry(slug);
  if (!entry || entry.status === "archived") return { title: "Theme not found" };

  const theme = toThemeItem(entry);
  return buildPageMetadata({
    title: `${theme.name} theme`,
    description: `${theme.name} is a ${theme.tier} theme for Markazify stores. ${theme.description} Open the live demo on your phone, then use it for your own store.`,
    path: `/themes/${theme.id}`,
  });
}

export default async function ThemeDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getThemeEntry(slug);
  if (!entry || entry.status === "archived") notFound();

  const theme = toThemeItem(entry);
  const tierLabel = theme.tier === "free" ? "Free" : "Premium";

  return (
    <Container className="grid items-center gap-12 pb-(--section-y) pt-12 md:pt-16 lg:grid-cols-2 lg:gap-16">
      <div className="flex flex-col">
        <span className="inline-flex w-fit items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          {tierLabel}
        </span>
        <h1 id="page-title" className="mt-4 text-h1 font-heading font-semibold tracking-tight leading-[1.1] text-balance">
          {theme.name}
        </h1>
        <p className="mt-5 text-lead leading-relaxed text-muted-foreground text-pretty">{theme.description}</p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild size="xl" className="rounded-full shadow-none">
            <a href={getSellerPortalUrl("signup")}>Use this theme</a>
          </Button>
          <Button asChild variant="outline" size="xl" className="rounded-full shadow-none">
            <a href={getThemeDemoUrl(theme.id)} target="_blank" rel="noopener noreferrer">
              Live demo
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        </div>

        <div className="mt-8">
          <ViewAllLink href="/themes">Back to all themes</ViewAllLink>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md">
        {theme.screenshot ? (
          <Image
            src={theme.screenshot.desktop}
            alt={`${theme.name} theme on a laptop`}
            width={1280}
            height={800}
            sizes="(min-width: 1024px) 40vw, 90vw"
            priority
            className="h-auto w-full rounded-lg border border-border"
          />
        ) : (
          <div aria-hidden="true">
            <ThemeDeviceStack id={theme.id} />
          </div>
        )}
      </div>
    </Container>
  );
}

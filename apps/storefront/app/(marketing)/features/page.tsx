import { Check } from "lucide-react";
import { PageHeader } from "@/components/marketing/layout/page-header";
import { ClosingCta } from "@/components/marketing/cta/closing-cta";
import { Card } from "@/components/shared/card";
import { Reveal } from "@/components/shared/reveal";
import { staggerDelay } from "@/components/shared/motion";
import { FEATURES } from "@/content/marketing/features";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Features",
  description:
    "Tools for Pakistani sellers: Cash on Delivery with WhatsApp checks, JazzCash and EasyPaisa payments, courier booking and storefronts built for phones.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Features"
        title="Tools for selling online in Pakistan"
        lead="Cash on Delivery, local payments, courier booking and storefronts built for phones, in one place."
      />

      <section aria-label="Feature list" className="mx-auto w-full max-w-7xl px-4 pb-(--section-y) sm:px-6 lg:px-8">
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <li key={feature.id} className="flex">
                <Reveal delay={staggerDelay(i, 80)} className="flex h-full w-full">
                  <Card as="article" padding="responsive" className="flex h-full w-full flex-col gap-4">
                    <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">{feature.title}</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                    <p className="mt-auto flex items-start gap-2 border-t border-border pt-4 text-sm font-medium text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>{feature.detail}</span>
                    </p>
                  </Card>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </section>

      <ClosingCta />
    </>
  );
}

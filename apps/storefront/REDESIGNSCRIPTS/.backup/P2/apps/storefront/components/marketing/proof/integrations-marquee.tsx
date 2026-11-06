import Image from "next/image";
import { INTEGRATIONS, type IntegrationItem } from "@/content/marketing/integrations";
import { Section } from "@/components/shared/section";
import { Reveal } from "@/components/shared/reveal";

/**
 * Integrations strip. Shows an official logo only when content/marketing/integrations.ts
 * sets logoPath (no file-system reads at render time). Otherwise: icon and name.
 */
function IntegrationBadge({ item, compact = false }: { item: IntegrationItem; compact?: boolean }) {
  if (item.logoPath) {
    return (
      <span className="inline-flex items-center justify-center grayscale opacity-75 transition-[filter,opacity,color] duration-200 ease-out-expo hover:grayscale-0 hover:opacity-100">
        <Image src={item.logoPath} alt={item.name} width={112} height={32} className="h-7 w-auto object-contain" />
      </span>
    );
  }

  const Icon = item.icon;
  return (
    <span className="inline-flex items-center justify-center gap-2.5 text-muted-foreground grayscale opacity-80 transition-[filter,opacity,color] duration-200 ease-out-expo hover:grayscale-0 hover:opacity-100 hover:text-foreground">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <span className={compact ? "text-base md:text-lg font-semibold tracking-tight" : "text-lg font-semibold tracking-tight"}>
        {item.name}
      </span>
    </span>
  );
}

export function IntegrationsMarquee() {
  const repeated = [...INTEGRATIONS, ...INTEGRATIONS];

  return (
    <Section labelledBy="integrations-heading" className="overflow-hidden" tone="muted">
      <Reveal delay={100}>
        <div className="flex flex-col items-center gap-8 md:gap-10">
          <h2 id="integrations-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground text-center">
            Payments, couriers and WhatsApp, built in
          </h2>

          <div className="relative flex w-full max-w-7xl overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] motion-reduce:mask-none motion-reduce:overflow-visible">
            {/* Animated marquee (hidden when reduced motion is requested) */}
            <div className="flex w-max motion-safe:animate-[marquee_40s_linear_infinite] motion-safe:hover:[animation-play-state:paused] motion-reduce:hidden">
              {repeated.map((item, i) => (
                <div
                  key={`${item.name}-${i}`}
                  className="mx-6 sm:mx-8 flex items-center justify-center shrink-0"
                  aria-hidden={i >= INTEGRATIONS.length ? "true" : undefined}
                >
                  <IntegrationBadge item={item} />
                </div>
              ))}
            </div>

            {/* Static wrap row (shown only when reduced motion is requested) */}
            <div className="hidden motion-reduce:flex flex-wrap justify-center gap-6 sm:gap-10 mx-auto">
              {INTEGRATIONS.map((item) => (
                <div key={item.name} className="flex items-center justify-center shrink-0">
                  <IntegrationBadge item={item} compact />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

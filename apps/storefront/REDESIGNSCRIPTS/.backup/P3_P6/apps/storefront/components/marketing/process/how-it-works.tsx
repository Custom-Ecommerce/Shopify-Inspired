import { ArrowRight, PackagePlus, ShoppingBag, UserPlus } from "lucide-react";
import { STEPS } from "@/content/marketing/steps";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { Reveal } from "@/components/shared/reveal";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/ui/button";
import { getSellerPortalUrl } from "@/lib/urls";

const STEP_ICONS = [UserPlus, PackagePlus, ShoppingBag] as const;

const FILL = "h-full bg-primary motion-safe:transition-transform motion-safe:duration-1000 motion-safe:ease-out-expo";

export function HowItWorks() {
  return (
    <Section id="how-it-works" labelledBy="process-heading" tone="muted">
      <div className="flex flex-col items-center">
        <SectionHeading
          id="process-heading"
          eyebrow="How It Works"
          title="From sign-up to your first order"
          lead="Focus on your products. We take care of the setup."
          align="center"
        />

        <Reveal className="group relative w-full">
          {/* Desktop rail: runs between the first and last badge centres and fills once revealed */}
          <div
            aria-hidden="true"
            className="absolute top-7 hidden h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-border md:block"
            style={{ left: "calc((100% - 4rem) / 6)", right: "calc((100% - 4rem) / 6)" }}
          >
            <div className={`${FILL} origin-left scale-x-100 motion-safe:scale-x-0 motion-safe:group-data-[revealed]:scale-x-100`} />
          </div>

          <ol className="relative grid gap-6 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => {
              const Icon = STEP_ICONS[i];
              const isLast = i === STEPS.length - 1;
              return (
                <li key={step.title} className="relative flex gap-5 md:flex-col md:gap-6">
                  {/* Mobile connector: from this badge down to the next one */}
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="absolute left-7 top-14 -bottom-6 w-0.5 -translate-x-1/2 overflow-hidden rounded-full bg-border md:hidden"
                    >
                      <span className={`${FILL} origin-top scale-y-100 motion-safe:scale-y-0 motion-safe:group-data-[revealed]:scale-y-100`} />
                    </span>
                  )}

                  <span className="relative z-10 flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground md:mx-auto md:size-16">
                    <Icon className="size-6" aria-hidden="true" />
                  </span>

                  <Card padding="md" className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Step {i + 1}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                  </Card>
                </li>
              );
            })}
          </ol>
        </Reveal>

        <Reveal delay={200} className="mt-12 flex justify-center">
          <Button asChild size="xl">
            <a href={getSellerPortalUrl("signup")}>
              Start free
              <ArrowRight className="ml-2 size-4" aria-hidden="true" />
            </a>
          </Button>
        </Reveal>
      </div>
    </Section>
  );
}

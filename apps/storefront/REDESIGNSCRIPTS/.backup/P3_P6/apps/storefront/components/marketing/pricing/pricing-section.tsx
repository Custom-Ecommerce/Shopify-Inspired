import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/shared/card";
import { Reveal } from "@/components/shared/reveal";
import { staggerDelay } from "@/components/shared/motion";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { PLANS } from "@/content/marketing/pricing";
import { formatPKR } from "@/lib/format";
import { getSellerPortalUrl } from "@/lib/urls";
import { cn } from "@/lib/utils";

/**
 * Plan cards. Used on the home page (with its heading) and on /pricing (heading supplied by the
 * page header, so the section keeps a visually hidden heading for its landmark). Prices come from
 * content/marketing/pricing.ts in PKR. Every plan CTA goes to seller signup.
 */
export function PricingSection({ withHeading = true }: { withHeading?: boolean }) {
  const signupUrl = getSellerPortalUrl("signup");

  return (
    <Section id="pricing" labelledBy={withHeading ? "pricing-heading" : "pricing-plans-heading"}>
      <div className="flex flex-col items-center">
        {withHeading ? (
          <SectionHeading
            id="pricing-heading"
            eyebrow="Pricing"
            title="Simple pricing"
            lead="Start free and upgrade when your store grows. Prices are in Pakistani rupees (PKR)."
            align="center"
          />
        ) : (
          <h2 id="pricing-plans-heading" className="sr-only">
            Plans and prices
          </h2>
        )}

        <div className="grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={100 + staggerDelay(i)} className="flex">
              <Card
                padding="responsive"
                className={cn(
                  "relative flex w-full flex-col justify-between",
                  plan.highlight && "border-primary ring-1 ring-primary",
                )}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    For growing stores
                  </span>
                )}

                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-foreground">{plan.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>

                  <p className="mt-6 flex items-baseline gap-2">
                    <span className="text-4xl font-semibold tracking-tight text-foreground">
                      {plan.monthlyPrice === 0 ? "Free" : formatPKR(plan.monthlyPrice)}
                    </span>
                    {plan.monthlyPrice > 0 && <span className="text-sm text-muted-foreground">/ month</span>}
                  </p>

                  <ul className="mt-6 space-y-3 border-t border-border pt-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm text-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8">
                  <Button asChild variant={plan.highlight ? "default" : "outline"} size="xl" className="w-full">
                    <a href={signupUrl}>{plan.cta}</a>
                  </Button>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

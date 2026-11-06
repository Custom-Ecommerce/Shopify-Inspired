import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/shared/reveal";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { PLANS } from "@/content/marketing/pricing";
import { formatPKR } from "@/lib/format";
import { getSellerPortalUrl } from "@/lib/urls";
import { cn } from "@/lib/utils";

/**
 * Plans as one hairline table. Used on the home page (with its heading) and on /pricing (heading
 * supplied by the page header, so the section keeps a visually hidden heading for its landmark).
 * Prices come from content/marketing/pricing.ts in PKR. Every plan CTA goes to seller signup.
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

        <Reveal delay={100} className="w-full max-w-4xl">
          <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-lg border border-border md:grid-cols-2 md:divide-x md:divide-y-0">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={cn("flex flex-col justify-between p-6 md:p-8", plan.highlight && "bg-surface-1")}
              >
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">{plan.name}</h3>
                    {plan.highlight && (
                      <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground">
                        For growing stores
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>

                  <p className="mt-6 flex items-baseline gap-2">
                    <span className="text-4xl font-semibold tracking-tight text-foreground">
                      {plan.monthlyPrice === 0 ? "Free" : formatPKR(plan.monthlyPrice)}
                    </span>
                    {plan.monthlyPrice > 0 && <span className="text-sm text-muted-foreground">/ month</span>}
                  </p>

                  <ul className="mt-6 divide-y divide-border border-y border-border">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 py-3 text-sm text-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8">
                  <Button
                    asChild
                    variant={plan.highlight ? "default" : "outline"}
                    size="xl"
                    className="w-full rounded-full shadow-none"
                  >
                    <a href={signupUrl}>{plan.cta}</a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

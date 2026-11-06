import { ArrowRight } from "lucide-react";
import { STEPS } from "@/content/marketing/steps";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { getSellerPortalUrl } from "@/lib/urls";

export function HowItWorks() {
  return (
    <Section id="how-it-works" labelledBy="process-heading">
      <div className="flex flex-col items-center">
        <SectionHeading
          id="process-heading"
          eyebrow="How It Works"
          title="From sign-up to your first order"
          lead="Focus on your products. We take care of the setup."
          align="center"
        />

        <Reveal className="w-full">
          <ol className="grid w-full divide-y divide-border border-y border-border md:grid-cols-3 md:divide-x md:divide-y-0">
            {STEPS.map((step, i) => (
              <li key={step.title} className="py-8 md:px-8 md:first:pl-0 md:last:pr-0">
                <p className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={200} className="mt-12 flex justify-center">
          <Button asChild size="xl" className="rounded-full shadow-none">
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

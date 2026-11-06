import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/shared/reveal";
import { Section } from "@/components/shared/section";
import { getSellerPortalUrl } from "@/lib/urls";

export function ClosingCta() {
  return (
    <Section labelledBy="cta-heading">
      <Reveal className="flex flex-col items-center text-center">
        <h2 id="cta-heading" className="font-heading text-h2 font-semibold tracking-tight text-balance">
          Ready to start selling?
        </h2>
        <p className="mt-4 max-w-xl text-lead text-muted-foreground text-pretty">
          Set up your store from the dashboard, take Cash on Delivery and local payments, and get help in Urdu or English.
        </p>
        <Button asChild size="xl" className="mt-8 rounded-full shadow-none">
          <a href={getSellerPortalUrl("signup")}>
            Start free
            <ArrowRight className="ml-2 size-5" aria-hidden="true" />
          </a>
        </Button>
        <p className="mt-5 text-sm text-muted-foreground">Free plan to start. Support in Urdu and English.</p>
      </Reveal>
    </Section>
  );
}

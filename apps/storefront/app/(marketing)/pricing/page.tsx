import { PageHeader } from "@/components/marketing/layout/page-header";
import { PricingSection } from "@/components/marketing/pricing/pricing-section";
import { PlanComparison } from "@/components/marketing/pricing/plan-comparison";
import { FaqSection } from "@/components/marketing/faq/faq-section";
import { ClosingCta } from "@/components/marketing/cta/closing-cta";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description:
    "Simple pricing for Pakistani sellers, in PKR. Start on the Free plan, then move to Growth for unlimited products, premium themes and your own domain.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Simple pricing"
        lead="Start free. Upgrade when your store needs more products, premium themes or your own domain. Prices are in Pakistani rupees (PKR)."
      />
      <PricingSection withHeading={false} />
      <PlanComparison />
      <FaqSection />
      <ClosingCta />
    </>
  );
}

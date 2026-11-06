import { PremiumHero } from "@/components/marketing/hero/premium-hero";
import { IntegrationsMarquee } from "@/components/marketing/proof/integrations-marquee";
import { PkValueRows } from "@/components/marketing/features/pk-value-rows";
import { HowItWorks } from "@/components/marketing/process/how-it-works";
import { ThemeShowcase } from "@/components/marketing/themes/theme-showcase";
import { PricingSection } from "@/components/marketing/pricing/pricing-section";
import { SupportSection } from "@/components/marketing/support/support-section";
import { FaqSection } from "@/components/marketing/faq/faq-section";
import { ClosingCta } from "@/components/marketing/cta/closing-cta";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Sell online in Pakistan",
  description:
    "Start an online store with Cash on Delivery, WhatsApp order checks, JazzCash and EasyPaisa. Pick a theme, add your products in PKR and start taking orders.",
  path: "/",
});

export default function MarketingPage() {
  return (
    <>
      <PremiumHero />
      <IntegrationsMarquee />
      <PkValueRows />
      <HowItWorks />
      <ThemeShowcase />
      <PricingSection />
      <SupportSection />
      <FaqSection />
      <ClosingCta />
    </>
  );
}

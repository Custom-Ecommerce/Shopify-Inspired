import { INTEGRATIONS } from "@/content/marketing/integrations";
import { Section } from "@/components/shared/section";

/**
 * Proof row: text only. No logos, no marquee, no animation (decision D7).
 * Names come from content/marketing/integrations.ts.
 */
export function IntegrationsMarquee() {
  return (
    <Section labelledBy="integrations-heading" className="py-10 md:py-12">
      <div className="flex flex-col items-center gap-6">
        <h2 id="integrations-heading" className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Payments, couriers and WhatsApp, built in
        </h2>
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {INTEGRATIONS.map((item) => (
            <li key={item.name} className="text-base font-medium text-muted-foreground">
              {item.name}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

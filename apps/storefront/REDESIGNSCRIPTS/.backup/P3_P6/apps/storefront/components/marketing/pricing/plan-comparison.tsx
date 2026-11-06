import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { COMPARISON_ROWS, PLANS } from "@/content/marketing/pricing";

/**
 * Plan comparison table. Rows and cell values come from content/marketing/pricing.ts,
 * which is derived from the plan feature lists. Scrolls sideways inside its own box on phones.
 */
export function PlanComparison() {
  return (
    <Section id="compare" labelledBy="compare-heading">
      <div className="flex flex-col items-center">
        <SectionHeading
          id="compare-heading"
          eyebrow="Compare"
          title="Compare plans"
          lead="The same details as the plan cards above, side by side."
          align="center"
          size="md"
        />

        <div className="w-full overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <caption className="sr-only">Compare the Free and Growth plans</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-5 py-4 font-semibold text-foreground">
                  Feature
                </th>
                {PLANS.map((plan) => (
                  <th scope="col" key={plan.id} className="px-5 py-4 font-semibold text-foreground">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-5 py-4 font-medium text-foreground">
                    {row.label}
                  </th>
                  {PLANS.map((plan) => (
                    <td key={plan.id} className="px-5 py-4 text-muted-foreground">
                      {row.values[plan.id] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

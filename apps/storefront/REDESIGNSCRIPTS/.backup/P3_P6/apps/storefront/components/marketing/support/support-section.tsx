import type { ReactNode } from "react";
import { Headset } from "lucide-react";
import { SUPPORT_CHANNELS, SUPPORT_HIGHLIGHTS } from "@/content/marketing/support";
import { Card } from "@/components/shared/card";
import { Reveal } from "@/components/shared/reveal";
import { staggerDelay } from "@/components/shared/motion";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** One chat message. Agent messages sit on the right in the brand colour. */
function Bubble({ from, children }: { from: "customer" | "agent"; children: ReactNode }) {
  const agent = from === "agent";
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
        agent
          ? "self-end rounded-br-md bg-primary text-primary-foreground"
          : "self-start rounded-bl-md border border-border bg-card text-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** Flat decorative chat card. It is an example of a support reply, not a live widget. */
function SupportChat() {
  return (
    <Card padding="md" className="mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Headset className="size-5" aria-hidden="true" />
        </span>
        <div className="flex flex-1 flex-col">
          <span className="font-semibold text-foreground">{BRAND.name} Support</span>
          <span className="text-xs text-muted-foreground">Support team</span>
        </div>
        <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground">
          Example
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/50 p-4">
        <Bubble from="customer">Salam! My JazzCash payment went through, but the order still says pending.</Bubble>
        <Bubble from="agent">Wa alaikum assalam. I can see the payment. Confirming your order now.</Bubble>
        <Bubble from="customer">Shukriya, that was quick!</Bubble>
      </div>

      <ul className="flex flex-wrap gap-2" aria-label="Ways to reach us">
        {SUPPORT_CHANNELS.map((channel) => (
          <li
            key={channel.id}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground"
          >
            <channel.icon className="size-4 text-primary" aria-hidden="true" />
            {channel.label}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SupportSection() {
  return (
    <Section id="support" labelledBy="support-heading">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div className="flex flex-col">
          <SectionHeading
            id="support-heading"
            eyebrow="Customer Service"
            title="Real people, on your side"
            lead="Selling online should not mean working things out alone. Reach a person who understands your market, whenever you need one."
            align="start"
            size="md"
            className="mb-8 md:mb-10"
          />

          <div className="flex flex-col gap-4">
            {SUPPORT_HIGHLIGHTS.map((item, i) => (
              <Reveal key={item.id} delay={100 + staggerDelay(i)}>
                <Card padding="md" className="flex items-start gap-5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <item.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>

          <Reveal delay={300} className="mt-8">
            <Button asChild size="xl">
              <a href="/contact">Talk to our team</a>
            </Button>
          </Reveal>
        </div>

        <Reveal delay={150} aria-hidden="true">
          <SupportChat />
        </Reveal>
      </div>
    </Section>
  );
}

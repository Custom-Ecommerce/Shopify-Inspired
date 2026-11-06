import * as React from "react";
import Link from "next/link";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { Card } from "@/components/shared/card";
import { Reveal } from "@/components/shared/reveal";
import { staggerDelay } from "@/components/shared/motion";
import {
  PK_VALUE_ROWS,
  PAYMENT_AND_COURIER_CHIPS,
  type PkValueVisualKind,
} from "@/content/marketing/features";
import { cn } from "@/lib/utils";

function CodWhatsappVisual() {
  return (
    <Card padding="md" className="w-full max-w-md">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">WhatsApp Order Check</p>
          <p className="truncate text-xs text-muted-foreground">
            Order <span className="font-mono">#ORD-7291</span> &middot; Rs. 4,250 (COD)
          </p>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-success-subtle px-2.5 text-xs font-medium text-success-subtle-foreground">
          Verified
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 text-xs sm:text-sm">
        <div className="max-w-[88%] self-start rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-foreground">
          Salam Ahmad! We received your COD order of Rs. 4,250 at Demo Store. Reply YES to confirm dispatch.
        </div>
        <div className="w-fit self-end rounded-lg bg-primary px-3.5 py-2 font-medium text-primary-foreground">
          YES, confirm my order
        </div>
        <div className="max-w-[88%] self-start rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-muted-foreground">
          Shukriya! Your order is confirmed and ready for courier pickup.
        </div>
      </div>
    </Card>
  );
}

function PaymentsCouriersVisual() {
  return (
    <Card padding="md" className="w-full max-w-md">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="text-xs text-muted-foreground">Checkout &amp; Dispatch</span>
        <span className="text-xs text-muted-foreground">PKR Native</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {PAYMENT_AND_COURIER_CHIPS.map((chip) => (
          <div
            key={chip.label}
            className="flex flex-col justify-between gap-2 rounded-md border border-border bg-surface-2 p-3"
          >
            <span className="text-xs text-muted-foreground">{chip.group}</span>
            <span className="text-sm font-medium text-foreground">{chip.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MobileStoreVisual() {
  return (
    <div className="w-full max-w-[260px]">
      <Card padding="sm" className="rounded-3xl border-border-strong">
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-border" />
        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border bg-surface-1 px-3 py-2">
            <span className="text-xs font-medium text-foreground">Noor Threads</span>
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              Rs. 2,800
            </span>
          </div>
          <div className="space-y-2.5 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-surface-1 p-2">
                <div className="mb-1.5 h-12 rounded-sm bg-secondary" />
                <div className="truncate text-[11px] font-medium text-foreground">Cotton Shawl</div>
                <div className="text-[11px] font-medium tabular-nums text-muted-foreground">Rs. 1,400</div>
              </div>
              <div className="rounded-md border border-border bg-surface-1 p-2">
                <div className="mb-1.5 h-12 rounded-sm bg-secondary" />
                <div className="truncate text-[11px] font-medium text-foreground">Khaddar Suit</div>
                <div className="text-[11px] font-medium tabular-nums text-muted-foreground">Rs. 2,800</div>
              </div>
            </div>
            <div className="rounded-md bg-primary py-2 text-center text-xs font-medium text-primary-foreground">
              Complete Order (COD / JazzCash)
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RowVisual({ kind }: { kind: PkValueVisualKind }) {
  if (kind === "cod-whatsapp") return <CodWhatsappVisual />;
  if (kind === "payments-couriers") return <PaymentsCouriersVisual />;
  return <MobileStoreVisual />;
}

export function PkValueRows() {
  return (
    <Section id="features" labelledBy="pk-features-heading">
      <SectionHeading
        id="pk-features-heading"
        eyebrow="Built for Pakistan"
        title="Everything a Pakistani online store needs on day one"
        lead="No foreign plugins or complicated workarounds. Verify Cash on Delivery orders, collect local wallet payments, and ship across the country."
        align="center"
      />

      <div className="flex flex-col">
        {PK_VALUE_ROWS.map((row, index) => {
          const isReversed = index % 2 === 1;
          return (
            <Reveal
              key={row.id}
              delay={100 + staggerDelay(index, 80)}
              className="grid grid-cols-1 gap-8 border-t border-border py-12 md:py-16 lg:grid-cols-12 lg:gap-x-8"
            >
              {/* Headline: 5 columns. Alternates between the left and the right side. */}
              <div
                className={cn(
                  "flex flex-col gap-4 lg:col-span-5 lg:row-start-1",
                  isReversed ? "lg:col-start-8" : "lg:col-start-1"
                )}
              >
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{row.eyebrow}</p>
                <h3 className="font-heading text-h2-sm font-semibold tracking-tight text-balance">{row.title}</h3>
              </div>

              {/* Body, bullets and a text link: 6 columns. */}
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-6 lg:col-span-6 lg:row-start-1",
                  isReversed ? "lg:col-start-1" : "lg:col-start-7"
                )}
              >
                <p className="text-body leading-relaxed text-muted-foreground">{row.description}</p>
                <ul className="flex flex-col divide-y divide-border border-y border-border text-sm text-foreground">
                  {row.bullets.map((bullet) => (
                    <li key={bullet} className="py-3">
                      {bullet}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/features"
                  className="w-fit rounded-sm text-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 outline-none transition-colors hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Learn more
                </Link>
                <div aria-hidden="true">
                  <RowVisual kind={row.visual} />
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

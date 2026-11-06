import * as React from "react";
import { Check, MessageCircle, Wallet, Truck, ShoppingBag } from "lucide-react";
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
    <Card padding="md" className="w-full max-w-md mx-auto">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MessageCircle className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              WhatsApp Order Check
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Order #ORD-7291 &middot; Rs. 4,250 (COD)
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
          <Check className="size-3" aria-hidden="true" />
          Verified
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 text-xs sm:text-sm">
        <div className="max-w-[88%] self-start rounded-2xl rounded-tl-sm border border-border bg-muted/60 px-3.5 py-2.5 text-foreground">
          Salam Ahmad! We received your COD order of Rs. 4,250 at Demo Store. Reply YES to confirm dispatch.
        </div>
        <div className="w-fit self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 font-medium text-primary-foreground">
          YES, confirm my order
        </div>
        <div className="max-w-[88%] self-start rounded-2xl rounded-tl-sm border border-border bg-muted/60 px-3.5 py-2 text-muted-foreground">
          Shukriya! Your order is confirmed and ready for courier pickup.
        </div>
      </div>
    </Card>
  );
}

function PaymentsCouriersVisual() {
  return (
    <Card padding="md" className="w-full max-w-md mx-auto">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Checkout & Dispatch
        </span>
        <span className="text-xs font-medium text-primary">PKR Native</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {PAYMENT_AND_COURIER_CHIPS.map((chip) => {
          const isPayment = chip.group === "Payment";
          const Icon = isPayment ? Wallet : Truck;
          return (
            <div
              key={chip.label}
              className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-muted/50 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {chip.group}
                </span>
                <Icon className="size-3.5 text-primary" aria-hidden="true" />
              </div>
              <span className="text-sm font-semibold text-foreground">
                {chip.label}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MobileStoreVisual() {
  return (
    <div className="mx-auto w-full max-w-[260px]">
      <Card padding="sm" className="rounded-3xl border-border-strong">
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-border" />
        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
            <span className="text-xs font-semibold text-foreground">Noor Threads</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <ShoppingBag className="size-3" aria-hidden="true" />
              Rs. 2,800
            </span>
          </div>
          <div className="p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/50 p-2">
                <div className="h-12 rounded-md bg-primary/10 mb-1.5" />
                <div className="text-[11px] font-medium text-foreground truncate">Cotton Shawl</div>
                <div className="text-[10px] font-semibold text-muted-foreground tabular-nums">Rs. 1,400</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-2">
                <div className="h-12 rounded-md bg-primary/15 mb-1.5" />
                <div className="text-[11px] font-medium text-foreground truncate">Khaddar Suit</div>
                <div className="text-[10px] font-semibold text-muted-foreground tabular-nums">Rs. 2,800</div>
              </div>
            </div>
            <div className="rounded-lg bg-primary py-2 text-center text-xs font-semibold text-primary-foreground">
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

      <div className="flex flex-col gap-12 md:gap-20">
        {PK_VALUE_ROWS.map((row, index) => {
          const isReversed = index % 2 === 1;
          return (
            <Reveal
              key={row.id}
              delay={100 + staggerDelay(index, 80)}
              className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12"
            >
              <div
                className={cn(
                  "flex flex-col gap-4 lg:col-span-6",
                  isReversed && "lg:order-2"
                )}
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  {row.eyebrow}
                </p>
                <h3 className="font-heading text-h2-sm font-semibold tracking-tight text-balance">
                  {row.title}
                </h3>
                <p className="text-body text-muted-foreground leading-relaxed">
                  {row.description}
                </p>
                <ul className="mt-2 flex flex-col gap-2.5">
                  {row.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2.5 text-sm text-foreground">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Check className="size-3" aria-hidden="true" />
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div
                aria-hidden="true"
                className={cn(
                  "lg:col-span-6",
                  isReversed && "lg:order-1"
                )}
              >
                <RowVisual kind={row.visual} />
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

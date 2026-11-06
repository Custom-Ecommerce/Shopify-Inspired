/* @markaz/storefront:phase2a-flat-premium-hero */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { HeroStage } from "./hero-stage";
import { AnnouncementBadge } from "./announcement-badge";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/shared/container";
import { getSellerPortalUrl, getThemeDemoUrl } from "@/lib/urls";

const HERO_TRUST_POINTS = [
  "COD with WhatsApp verification",
  "JazzCash and EasyPaisa",
  "Support in Urdu and English",
] as const;

export function PremiumHero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden bg-background py-(--section-y) md:py-(--section-y-md)">
      <Container>
        <div className="grid grid-cols-1 items-center gap-x-12 gap-y-12 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col items-start lg:col-span-6">
            <AnnouncementBadge />

            <h1
              id="hero-heading"
              className="motion-title mt-6 font-heading text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] text-balance text-foreground md:text-5xl lg:text-[4rem]"
            >
              Sell online in Pakistan with Cash on Delivery built in
            </h1>

            <p className="mt-6 max-w-xl text-lead text-muted-foreground text-pretty">
              Create your own online shop with Cash on Delivery, JazzCash, EasyPaisa and local couriers.
            </p>

            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button asChild size="xl" className="w-full gap-2 rounded-full shadow-none sm:w-auto">
                <a href={getSellerPortalUrl("signup")}>
                  Start free <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </Button>
              <Button asChild variant="outline" size="xl" className="w-full rounded-full shadow-none sm:w-auto">
                <a href={getThemeDemoUrl()}>See a live store</a>
              </Button>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              Free plan to start. Support in Urdu and English.
            </p>

            <ul className="mt-10 flex w-full flex-col divide-y divide-border border-y border-border text-sm text-muted-foreground sm:w-auto sm:flex-row sm:divide-x sm:divide-y-0">
              {HERO_TRUST_POINTS.map((label) => (
                <li key={label} className="py-3 sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <div className="motion-rise min-w-0 lg:col-span-6">
            <HeroStage />
          </div>
        </div>
      </Container>
    </section>
  );
}

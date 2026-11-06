/* @markaz/storefront:phase2a-flat-premium-hero */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { HeroStage } from "./hero-stage";
import { AnnouncementBadge } from "./announcement-badge";
import { ArrowRight, MessageCircle, Wallet, Headset } from "lucide-react";
import { Container } from "@/components/shared/container";
import { riseDelay } from "@/components/shared/motion";
import { getSellerPortalUrl, getThemeDemoUrl } from "@/lib/urls";

const HERO_TRUST_POINTS = [
  {
    icon: MessageCircle,
    label: "COD with WhatsApp verification",
  },
  {
    icon: Wallet,
    label: "JazzCash and EasyPaisa",
  },
  {
    icon: Headset,
    label: "Support in Urdu and English",
  },
] as const;

export function PremiumHero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden py-(--section-y) md:py-(--section-y-md) bg-background">
      <div aria-hidden="true" className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none" />

      <Container className="relative z-10">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
          <div className="motion-rise" style={riseDelay(0)}>
            <AnnouncementBadge />
          </div>

          <h1 id="hero-heading" className="motion-title mt-6 font-heading text-display font-bold tracking-tight text-balance">
            Sell online in Pakistan with{" "}
            <span className="text-primary">Cash on Delivery</span> built in
          </h1>

          <p className="mt-6 motion-rise text-lead text-muted-foreground max-w-2xl text-balance" style={riseDelay(80)}>
            Create your own online shop with Cash on Delivery, JazzCash, EasyPaisa and local couriers.
          </p>

          <div className="motion-rise mt-8 flex w-full flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3 sm:gap-4" style={riseDelay(160)}>
            <Button asChild size="xl" className="w-full sm:w-auto gap-2">
              <a href={getSellerPortalUrl("signup")}>
                Start free <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline" size="xl" className="w-full sm:w-auto">
              <a href={getThemeDemoUrl()}>See a live store</a>
            </Button>
          </div>

          <p className="mt-4 motion-rise text-xs sm:text-sm text-muted-foreground font-medium" style={riseDelay(160)}>
            Free plan to start. Support in Urdu and English.
          </p>

          <ul className="motion-rise mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-border pt-6 text-sm text-muted-foreground" style={riseDelay(240)}>
            {HERO_TRUST_POINTS.map((point) => {
              const Icon = point.icon;
              return (
                <li key={point.label} className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{point.label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="motion-rise mt-12 md:mt-16" style={riseDelay(320)}>
          <HeroStage />
        </div>
      </Container>
    </section>
  );
}

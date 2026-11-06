import { cn } from "@/lib/utils";
import { IsoStage } from "@/components/shared/IsoStage";
import { FloatLayer } from "@/components/shared/FloatLayer";
import { MockupDashboard } from "./mockup/MockupDashboard";
import { MockupOrderCard } from "./mockup/MockupOrderCard";
import { MockupPaymentChip } from "./mockup/MockupPaymentChip";

/**
 * AuthProofPanel: the decorative left column proof panel shown on ≥lg screens.
 * Blueprint §3.2: proof panel is P1b (optional polish) — shows on desktop only.
 *
 * Server component: CSS-only tilt, float animation runs from globals.css keyframes.
 * aria-hidden because it's purely decorative. Satellites use the same composition
 * pattern as the storefront HeroStage (IsoStage > FloatLayer > [component]).
 */
export function AuthProofPanel({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden lg:flex lg:flex-col lg:justify-center lg:gap-8 lg:pr-12 -mt-16",
        "relative z-10",
        className
      )}
    >
      {/* Tagline */}
      <div className="flex flex-col gap-2">
        <p className="font-heading text-4xl font-semibold leading-tight tracking-tight text-foreground">
          Your store,
          <br />
          fully in control.
        </p>
        <p className="text-sm text-muted-foreground max-w-xs">
          Manage products, orders, and payments — all from one place.
        </p>
      </div>

      {/* Floating dashboard stage */}
      <div
        className="relative w-full motion-safe:opacity-0 motion-safe:animate-[fadeInHero_0.8s_cubic-bezier(0.16,1,0.3,1)_forwards]"
        style={{ animationDelay: "300ms" }}
      >
        <IsoStage preset="hero" className="w-full max-w-xl">
          <FloatLayer speed="slow">
            <div className="relative flex-1 overflow-hidden mt-2 w-full"><div className="absolute inset-0 origin-top scale-[0.75] 2xl:scale-[0.90]"><MockupDashboard /></div></div>
          </FloatLayer>

          {/* Left satellite: COD order */}
          <div
            className={cn(
              "sm:absolute sm:-bottom-8 sm:left-4 sm:mx-0 sm:mt-0 sm:w-64",
              "md:[transform:translateZ(48px)]",
              "lg:left-0 lg:bottom-auto lg:top-[58%] lg:w-72",
            )}
          >
            <FloatLayer speed="mid" delay={-1.2}>
              <MockupOrderCard />
            </FloatLayer>
          </div>

          {/* Right satellite: payment chip */}
          <div
            className={cn(
              "absolute hidden md:block",
              "md:-top-7 md:right-4 md:[transform:translateZ(72px)]",
              "lg:-right-6",
            )}
          >
            <FloatLayer speed="fast" delay={-2.7}>
              <MockupPaymentChip />
            </FloatLayer>
          </div>
        </IsoStage>
      </div>
    </div>
  );
}

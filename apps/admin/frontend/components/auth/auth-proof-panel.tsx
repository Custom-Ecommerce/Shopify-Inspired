import { cn } from "@/lib/utils";
import { IsoStage } from "@/components/shared/iso-stage";
import { FloatLayer } from "@/components/shared/float-layer";
import { MockupDashboard } from "./mockup/mockup-dashboard";
import { MockupApprovalCard } from "./mockup/mockup-approval-card";
import { MockupSyncChip } from "./mockup/mockup-sync-chip";

/**
 * AuthProofPanel: the decorative left column shown on lg+ screens.
 * Server component. CSS-only tilt; float animation runs from globals.css keyframes.
 * aria-hidden because it is purely decorative.
 */
export function AuthProofPanel({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("mt-0 hidden lg:flex lg:flex-col lg:justify-center lg:gap-6 lg:pr-12", "relative z-10", className)}
    >
      {/* Tagline */}
      <div className="flex flex-col gap-2">
        <p className="font-heading text-4xl font-semibold leading-tight tracking-tight text-foreground">
          The whole platform,
          <br />
          under your control.
        </p>
        <p className="max-w-xs text-sm text-muted-foreground">Review stores and sellers, set commission, and watch sync health, all from one console.</p>
      </div>

      {/* Floating console stage */}
      <div
        className="relative mt-4 w-full motion-safe:opacity-0 motion-safe:animate-[fadeInHero_0.8s_cubic-bezier(0.16,1,0.3,1)_forwards]"
        style={{ animationDelay: "300ms" }}
      >
        <IsoStage preset="hero" className="w-full max-w-xl lg:-mb-20 lg:origin-top-left lg:scale-[0.8]">
          <FloatLayer speed="slow">
            <MockupDashboard />
          </FloatLayer>

          {/* Left satellite: store approval */}
          <div className="absolute left-0 top-[58%] w-72 [transform:translateZ(48px)]">
            <FloatLayer speed="mid" delay={-1.2}>
              <MockupApprovalCard />
            </FloatLayer>
          </div>

          {/* Right satellite: sync health */}
          <div className="absolute -right-6 -top-7 [transform:translateZ(72px)]">
            <FloatLayer speed="fast" delay={-2.7}>
              <MockupSyncChip />
            </FloatLayer>
          </div>
        </IsoStage>
      </div>
    </div>
  );
}

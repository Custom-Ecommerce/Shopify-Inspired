/* @markaz/storefront:phase2a-flat-hero-stage */
import * as React from "react";
import { DashboardMockup } from "@/components/marketing/mockup/dashboard-mockup";

/** Right column of the hero: the code-built product panel. Decorative, sample data only. */
export function HeroStage() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-xl lg:max-w-none">
      <DashboardMockup />
    </div>
  );
}

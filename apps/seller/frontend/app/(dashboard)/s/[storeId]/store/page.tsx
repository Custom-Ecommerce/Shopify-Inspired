import { Suspense } from "react";
import { StoreSettingsView } from "@/components/dashboard/settings/StoreSettingsView";

/** Store Settings (Sprint 4 EP-04). The old single-form page and its save code were replaced by the tabbed screen. */
export default function DashboardStorePage() {
  return (
    <Suspense fallback={null}>
      <StoreSettingsView />
    </Suspense>
  );
}

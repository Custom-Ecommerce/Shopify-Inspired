import type { Metadata } from "next";
import { Suspense } from "react";
import { ReferralsView } from "@/components/referrals/referrals-view";

export const metadata: Metadata = { title: "Referrals" };

export default function ReferralsPage() {
  return (
    <Suspense fallback={null}>
      <ReferralsView />
    </Suspense>
  );
}

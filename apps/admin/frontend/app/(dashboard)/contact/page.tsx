import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactView } from "@/components/support/contact-view";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <Suspense fallback={null}>
      <ContactView />
    </Suspense>
  );
}

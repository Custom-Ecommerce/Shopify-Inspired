import { LegalDocument } from "@/components/marketing/layout/legal-document";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Terms of Service",
  description:
    "Read the Markazify terms of service. This page is a draft pending legal review, and the final text will be published after that review.",
  path: "/legal/terms",
});

export default function TermsOfServicePage() {
  return (
    <LegalDocument title="Terms of Service">
      <p>This document is currently pending legal review and serves as a placeholder.</p>
      <h2>1. Introduction</h2>
      <p>Information regarding terms of service will be detailed here.</p>
    </LegalDocument>
  );
}

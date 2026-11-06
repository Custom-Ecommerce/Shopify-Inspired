import { LegalDocument } from "@/components/marketing/layout/legal-document";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Cookie Policy",
  description:
    "Read the Markazify cookie policy. This page is a draft pending legal review, and the final text will be published after that review.",
  path: "/legal/cookies",
});

export default function CookiePolicyPage() {
  return (
    <LegalDocument title="Cookie Policy">
      <p>This document is currently pending legal review and serves as a placeholder.</p>
      <h2>1. Introduction</h2>
      <p>Information regarding cookie policy will be detailed here.</p>
    </LegalDocument>
  );
}

import { LegalDocument } from "@/components/marketing/layout/legal-document";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description:
    "Read the Markazify privacy policy. This page is a draft pending legal review, and the final text will be published after that review.",
  path: "/legal/privacy",
});

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument title="Privacy Policy">
      <p>This document is currently pending legal review and serves as a placeholder.</p>
      <h2>1. Introduction</h2>
      <p>Information regarding privacy policy will be detailed here.</p>
    </LegalDocument>
  );
}

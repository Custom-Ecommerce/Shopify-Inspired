import type { Metadata } from "next";
import { RetentionView } from "@/components/retention/retention-view";

export const metadata: Metadata = { title: "Retention" };

export default function RetentionPage() {
  return <RetentionView />;
}

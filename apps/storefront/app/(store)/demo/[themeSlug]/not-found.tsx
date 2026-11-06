"use client";

import { useParams } from "next/navigation";
import { ThemedNotFound } from "@/components/themed-state";

/** The demo's not-found page, rendered inside the demo layout. */
export default function DemoNotFound() {
  const { themeSlug } = useParams<{ themeSlug: string }>();
  return <ThemedNotFound slug={themeSlug} />;
}

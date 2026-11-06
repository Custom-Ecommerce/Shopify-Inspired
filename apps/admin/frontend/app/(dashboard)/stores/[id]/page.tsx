import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreDetailView } from "@/components/stores/store-detail-view";
import { isObjectId } from "@/lib/proxy";

export const metadata: Metadata = { title: "Store" };

export default async function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  return <StoreDetailView id={id} />;
}

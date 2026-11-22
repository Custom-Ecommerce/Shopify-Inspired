"use client";

import { MediaLibrary } from "@/components/dashboard/media/MediaLibrary";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";

/** Sprint 7 (S7-B2): the store's media library. */
export default function DashboardMediaPage() {
  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Media" description="Pictures and videos for your products, store settings and blog." />
      <MediaLibrary />
    </div>
  );
}

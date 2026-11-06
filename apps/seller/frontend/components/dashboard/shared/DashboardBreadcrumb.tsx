"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { parseStorePath, storeBasePath } from "@/lib/store-routes";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const LABELS: Record<string, string> = {
  "": "Overview",
  products: "Products",
  orders: "Orders",
  inventory: "Inventory",
  reviews: "Reviews",
  discounts: "Discounts",
  returns: "Returns",
  referrals: "Referrals",
  broadcast: "Broadcast",
  blog: "Blog & Lookbook",
  store: "Store Settings",
  analytics: "Analytics",
  domain: "Domain",
  earnings: "Earnings",
  new: "New",
  import: "Import",
};

export function DashboardBreadcrumb() {
  const pathname = usePathname();

  // Only meaningful under `/s/[storeId]/…`; crumbs are relative to that store.
  const parsed = parseStorePath(pathname);
  if (!parsed) return null;

  const segments = parsed.rest.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const basePath = storeBasePath(parsed.storeId);
  let href = basePath;
  const crumbs = segments.map((seg, i) => {
    href += `/${seg}`;
    const isLast = i === segments.length - 1;
    const label = LABELS[seg] ?? decodeURIComponent(seg);
    return { href, label, isLast };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {/* BreadcrumbLink uses useRender — render prop is supported */}
          <BreadcrumbLink render={<Link href={basePath} />}>Overview</BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((c) => (
          <span key={c.href} className="flex items-center gap-1.5">
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {c.isLast ? (
                <BreadcrumbPage>{c.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

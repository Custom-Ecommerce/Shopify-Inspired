"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { StoreSwitcher } from "@/components/dashboard/StoreSwitcher";
import { BrandMark } from "@/components/shared/BrandMark";
import { Button } from "@/components/ui/button";
import { useDashboard, useStoreHref } from "@/lib/dashboard-context";
import { storeBasePath } from "@/lib/store-routes";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Archive,
  Star,
  RotateCcw,
  Tag,
  Users,
  Megaphone,
  BookOpen,
  BarChart,
  DollarSign,
  CreditCard,
  Settings,
  Globe,
  ExternalLink,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Single source of truth for navigation.
 * Used by DashboardSidebar and DashboardBreadcrumb (import from here).
 * Blueprint §4.3: 4 groups, 15 destinations exactly.
 *
 * `href`s are STORE-RELATIVE (e.g. "/orders"); they are resolved to
 * `/s/<storeId>/orders` with the store-aware `href()` helper at render time.
 */
export const NAV_GROUPS = [
  {
    label: "Store",
    links: [
      { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/products", label: "Products", icon: Package },
      { href: "/orders", label: "Orders", icon: ShoppingCart },
      { href: "/inventory", label: "Inventory", icon: Archive },
      { href: "/returns", label: "Returns", icon: RotateCcw },
      { href: "/reviews", label: "Reviews", icon: Star },
    ],
  },
  {
    label: "Marketing",
    links: [
      { href: "/discounts", label: "Discounts", icon: Tag },
      { href: "/referrals", label: "Referrals", icon: Users },
      { href: "/broadcast", label: "Broadcast", icon: Megaphone },
      { href: "/blog", label: "Blog & Lookbook", icon: BookOpen },
    ],
  },
  {
    label: "Finance & Analytics",
    links: [
      { href: "/analytics", label: "Analytics", icon: BarChart },
      { href: "/earnings", label: "Earnings", icon: DollarSign },
      { href: "/billing", label: "Billing & Payments", icon: CreditCard },
    ],
  },
  {
    label: "Settings",
    links: [
      { href: "/store", label: "Store Settings", icon: Settings },
      { href: "/domain", label: "Domain", icon: Globe },
    ],
  },
] as const;

export function DashboardSidebar() {
  const { user, storeId, activeStore } = useDashboard();
  const href = useStoreHref();
  const pathname = usePathname();
  const basePath = storeBasePath(storeId);
  const rootDomainUrl = process.env.NEXT_PUBLIC_ROOT_DOMAIN_URL || "localhost:3000";
  const protocol = rootDomainUrl.includes("localhost") ? "http" : "https";

  // Compare against the store-relative part of the URL ("/s/42/orders/7" → "/orders/7").
  const relativePath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;

  function isActive(linkPath: string, exact?: boolean) {
    if (exact) return relativePath === linkPath;
    // Prefix match: /orders matches /orders/123
    return relativePath === linkPath || relativePath.startsWith(linkPath + "/");
  }

  return (
    <Sidebar
      collapsible="icon"
      variant="floating"
      className="border-0 bg-transparent"
    >
      {/* Header: BrandMark collapses to the "M" tile in icon mode via sidebar CSS */}
      <SidebarHeader className="px-3 py-4">
        <div className="group-data-[collapsible=icon]:hidden">
          <BrandMark href="/" />
        </div>
        {/* Icon mode: just the "M" tile */}
        <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-lg font-semibold text-primary-foreground">
            M
          </div>
        </div>
      </SidebarHeader>

      {/* Workspace switcher (Blueprint §6.6) — replaces the static store-name chip */}
      <div className="px-2 pb-2">
        <StoreSwitcher />
      </div>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            {/* Group labels hidden in icon mode by the sidebar primitive */}
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.links.map((link) => {
                  const active = isActive(link.href, "exact" in link ? link.exact : false);
                  const Icon = link.icon;
                  return (
                    <SidebarMenuItem key={link.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={link.label}
                        render={<Link href={href(link.href)} />}
                        className="h-9 gap-3 rounded-lg text-sm font-medium data-active:font-semibold"
                      >
                        {/* Active icon: flat primary tile */}
                        <span
                          className={
                            active
                              ? "flex size-6 shrink-0 items-center justify-center rounded-md bg-primary"
                              : undefined
                          }
                        >
                          <Icon className={active ? "size-3.5 text-primary-foreground" : "size-4"} />
                        </span>
                        <span>{link.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu className="gap-2">
          {/* "View My Store": outlined external CTA (blueprint §4.3) */}
          {activeStore && (
            <SidebarMenuItem>
              <div className="group-data-[collapsible=icon]:hidden">
                <Button
                  variant="clay-soft"
                  size="sm"
                  className="w-full justify-center"
                  render={
                    <a
                      href={`${protocol}://${activeStore.slug}.${rootDomainUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  View My Store <ExternalLink className="size-3" />
                </Button>
              </div>
              {/* Icon mode: just the external link icon */}
              <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <a
                        href={`${protocol}://${activeStore.slug}.${rootDomainUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      />
                    }
                  >
                    <ExternalLink className="size-4" />
                    <span className="sr-only">View My Store</span>
                  </TooltipTrigger>
                  <TooltipContent side="right">View My Store</TooltipContent>
                </Tooltip>
              </div>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <UserMenu user={user} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

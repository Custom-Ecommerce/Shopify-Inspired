import { Container } from "@/components/shared/container";
import { BrandMark } from "@/components/shared/brand-mark";
import { MobileNav } from "./mobile-nav";
import { Button } from "@/components/ui/button";
import { navLinks } from "@/content/marketing/nav";
import { getSellerPortalUrl } from "@/lib/urls";
import { HeaderWrapper } from "./header-wrapper";
import { ActiveLink } from "./active-link";

export function SiteHeader() {
  return (
    <HeaderWrapper>
      <Container className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <BrandMark />
          <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
            {navLinks.map((link) => (
              <ActiveLink
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </ActiveLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <div className="hidden items-center gap-2 lg:flex">
            <Button asChild variant="ghost" className="h-9 px-3 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground">
              <a href={getSellerPortalUrl("login")}>Log in</a>
            </Button>
            <Button asChild className="h-9 rounded-full px-4 text-sm font-medium shadow-none">
              <a href={getSellerPortalUrl("signup")}>Start free</a>
            </Button>
          </div>
          <MobileNav />
        </div>
      </Container>
    </HeaderWrapper>
  );
}

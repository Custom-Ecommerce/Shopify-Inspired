import { Container } from "@/components/shared/container";
import { BrandMark } from "@/components/shared/brand-mark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { MobileNav } from "./mobile-nav";
import { Button } from "@/components/ui/button";
import { navLinks } from "@/content/marketing/nav";
import { getSellerPortalUrl } from "@/lib/urls";
import { HeaderWrapper } from "./header-wrapper";
import { ActiveLink } from "./active-link";

export function SiteHeader() {
  return (
    <HeaderWrapper>
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <BrandMark />
          <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <ActiveLink
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm px-1 py-0.5"
              >
                {link.label}
              </ActiveLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2">
            <Button asChild variant="ghost" className="min-h-11 font-semibold text-sm px-4">
              <a href={getSellerPortalUrl("login")}>Log in</a>
            </Button>
            <Button asChild className="min-h-11 font-semibold text-sm px-5">
              <a href={getSellerPortalUrl("signup")}>Start free</a>
            </Button>
          </div>
          <ThemeToggle />
          <MobileNav />
        </div>
      </Container>
    </HeaderWrapper>
  );
}

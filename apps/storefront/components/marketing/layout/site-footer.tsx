import Link from "next/link";
import { footerColumns, SUPPORT_CONTACT } from "@/content/marketing/footer";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { BRAND } from "@/lib/brand";

const LINK =
  "inline-flex min-h-10 items-center rounded-sm text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function SiteFooter() {
  const year = new Date().getFullYear();
  const { whatsapp, email } = SUPPORT_CONTACT;
  const columns = Object.entries(footerColumns).filter(([title]) => title !== "Legal");
  const legal = footerColumns.Legal ?? [];

  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {columns.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <ul className="mt-3 space-y-0.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
                {title === "Support" && whatsapp && (
                  <li>
                    <a href={`https://wa.me/${whatsapp}`} className={LINK}>
                      WhatsApp support
                    </a>
                  </li>
                )}
                {title === "Support" && email && (
                  <li>
                    <a href={`mailto:${email}`} className={LINK}>
                      {email}
                    </a>
                  </li>
                )}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            &copy; {year} {BRAND.name}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <nav aria-label="Legal">
              <ul className="flex flex-wrap gap-x-6">
                {legal.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

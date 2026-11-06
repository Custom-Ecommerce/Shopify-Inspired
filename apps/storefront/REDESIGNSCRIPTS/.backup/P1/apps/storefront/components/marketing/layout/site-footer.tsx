import Link from "next/link";
import { footerColumns, SUPPORT_CONTACT } from "@/content/marketing/footer";
import { BRAND } from "@/lib/brand";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function SiteFooter() {
  const year = new Date().getFullYear();
  const { whatsapp, email } = SUPPORT_CONTACT;

  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
          {Object.entries(footerColumns).map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <p className="text-sm font-semibold uppercase tracking-wider text-foreground">{title}</p>
              <ul className="mt-3 space-y-1">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {(whatsapp || email) && (
          <div className="mt-10 flex flex-col gap-2 border-t border-border pt-8 text-sm text-muted-foreground sm:flex-row sm:gap-6">
            {whatsapp && (
              <a href={`https://wa.me/${whatsapp}`} className={LINK}>
                WhatsApp support
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} className={LINK}>
                {email}
              </a>
            )}
          </div>
        )}

        <p className="mt-10 border-t border-border pt-8 text-sm text-muted-foreground">
          &copy; {year} {BRAND.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

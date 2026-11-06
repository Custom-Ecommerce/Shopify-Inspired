#!/usr/bin/env node
// apps/storefront/REDESIGNSCRIPTS/patch_redesign_P2.mjs
//
// Markazify redesign, phase P2: hero and product proof
// Zero dependencies. Flags: --dry-run | --apply | --verify | --revert
// Save this file in apps/storefront/REDESIGNSCRIPTS/. It only writes inside its allowlist.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SF = path.join(ROOT, "apps", "storefront");

const M = {
  "phase": "P2",
  "allow": [
    "apps/storefront/components/marketing/hero/**",
    "apps/storefront/components/marketing/proof/integrations-marquee.tsx",
    "apps/storefront/components/marketing/mockup/**",
    "apps/storefront/app/globals.css"
  ],
  "notes": [
    "Hero: 12-column grid, copy and hrefs unchanged. The headline has no accent colour and is plain text (LCP). Icons and the grid background are removed.",
    "D7: the hero float animation and the logo marquee are REMOVED. Both are decorative with no clear value. LCP and JS were not measured here: run Lighthouse before and after.",
    "Motion: one 250ms rise-in on the headline and the panel only. globals.css changes are in the motion section only.",
    "ProductMock is DashboardMockup (also exported as ProductMock). All figures are sample data in PKR.",
    "Proof row: text names from content/marketing/integrations.ts. The export name IntegrationsMarquee is kept so app/(marketing)/page.tsx is unchanged."
  ],
  "manual": [
    "Run Lighthouse (mobile) on / before P2 and after. Hero LCP must be under 2.5 s and not worse than before.",
    "At 375 px there must be no horizontal scroll; order is headline, CTAs, panel."
  ],
  "modify": [
    {
      "rel": "apps/storefront/components/marketing/hero/announcement-badge.tsx",
      "beforeSha": "db459f76488b4caad6a3054e3b28c664339e8da8252670630339dba5c7a95b1e",
      "afterSha": "b4465da2b0749e1c27bc0e02891f6c99dd136e841b34e87585ea6e644da06090",
      "edits": [
        {
          "name": "announcement badge",
          "expect": 1,
          "before": [
            "export function AnnouncementBadge() {",
            "  return (",
            "    <Badge variant=\"secondary\" className=\"pl-1 pr-3 py-1 gap-2 rounded-full font-medium hover:bg-secondary border border-border bg-muted/50\">",
            "      <div className=\"flex items-center justify-center bg-background rounded-full px-2 py-0.5 gap-1.5 shadow-xs\">",
            "        <span className=\"relative flex size-2\">",
            "          <span className=\"absolute inline-flex h-full w-full rounded-full bg-success opacity-75 motion-safe:animate-[ping_1s_cubic-bezier(0,0,0.2,1)_3_forwards]\" />",
            "          <span className=\"relative inline-flex size-2 rounded-full bg-success\" />",
            "        </span>",
            "        <span className=\"text-xs text-foreground font-semibold\">Built for Pakistan</span>",
            "      </div>",
            "      <span className=\"hidden text-sm text-secondary-foreground sm:inline\">COD, JazzCash and EasyPaisa</span>",
            "    </Badge>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "export function AnnouncementBadge() {",
            "  return (",
            "    <Badge variant=\"outline\" className=\"h-8 gap-3 rounded-full border-border bg-surface-1 px-3.5 text-sm font-normal text-muted-foreground\">",
            "      <span className=\"font-medium text-foreground\">Built for Pakistan</span>",
            "      <span aria-hidden=\"true\" className=\"hidden h-3.5 w-px bg-border sm:block\" />",
            "      <span className=\"hidden sm:inline\">COD, JazzCash and EasyPaisa</span>",
            "    </Badge>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/hero/premium-hero.tsx",
      "beforeSha": "de85b18309c0279e1be97db2318fc599cd967cb1bd83c4af28d59b5a3acc887f",
      "afterSha": "3bc6c72dc06290e53c1a37b508ad1363a6501e5193722a1fcbda2f0d3bc00bab",
      "edits": [
        {
          "name": "hero grid",
          "expect": 1,
          "before": [
            "import * as React from \"react\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { HeroStage } from \"./hero-stage\";",
            "import { AnnouncementBadge } from \"./announcement-badge\";",
            "import { ArrowRight, MessageCircle, Wallet, Headset } from \"lucide-react\";",
            "import { Container } from \"@/components/shared/container\";",
            "import { riseDelay } from \"@/components/shared/motion\";",
            "import { getSellerPortalUrl, getThemeDemoUrl } from \"@/lib/urls\";",
            "",
            "const HERO_TRUST_POINTS = [",
            "  {",
            "    icon: MessageCircle,",
            "    label: \"COD with WhatsApp verification\",",
            "  },",
            "  {",
            "    icon: Wallet,",
            "    label: \"JazzCash and EasyPaisa\",",
            "  },",
            "  {",
            "    icon: Headset,",
            "    label: \"Support in Urdu and English\",",
            "  },",
            "] as const;",
            "",
            "export function PremiumHero() {",
            "  return (",
            "    <section aria-labelledby=\"hero-heading\" className=\"relative overflow-hidden py-(--section-y) md:py-(--section-y-md) bg-background\">",
            "      <div aria-hidden=\"true\" className=\"absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none\" />",
            "",
            "      <Container className=\"relative z-10\">",
            "        <div className=\"flex flex-col items-center text-center max-w-4xl mx-auto\">",
            "          <div className=\"motion-rise\" style={riseDelay(0)}>",
            "            <AnnouncementBadge />",
            "          </div>",
            "",
            "          <h1 id=\"hero-heading\" className=\"motion-title mt-6 font-heading text-display font-bold tracking-tight text-balance\">",
            "            Sell online in Pakistan with{\" \"}",
            "            <span className=\"text-primary\">Cash on Delivery</span> built in",
            "          </h1>",
            "",
            "          <p className=\"mt-6 motion-rise text-lead text-muted-foreground max-w-2xl text-balance\" style={riseDelay(80)}>",
            "            Create your own online shop with Cash on Delivery, JazzCash, EasyPaisa and local couriers.",
            "          </p>",
            "",
            "          <div className=\"motion-rise mt-8 flex w-full flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3 sm:gap-4\" style={riseDelay(160)}>",
            "            <Button asChild size=\"xl\" className=\"w-full sm:w-auto gap-2\">",
            "              <a href={getSellerPortalUrl(\"signup\")}>",
            "                Start free <ArrowRight className=\"size-4\" aria-hidden=\"true\" />",
            "              </a>",
            "            </Button>",
            "            <Button asChild variant=\"outline\" size=\"xl\" className=\"w-full sm:w-auto\">",
            "              <a href={getThemeDemoUrl()}>See a live store</a>",
            "            </Button>",
            "          </div>",
            "",
            "          <p className=\"mt-4 motion-rise text-xs sm:text-sm text-muted-foreground font-medium\" style={riseDelay(160)}>",
            "            Free plan to start. Support in Urdu and English.",
            "          </p>",
            "",
            "          <ul className=\"motion-rise mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-border pt-6 text-sm text-muted-foreground\" style={riseDelay(240)}>",
            "            {HERO_TRUST_POINTS.map((point) => {",
            "              const Icon = point.icon;",
            "              return (",
            "                <li key={point.label} className=\"flex items-center gap-2\">",
            "                  <Icon className=\"size-4 shrink-0 text-primary\" aria-hidden=\"true\" />",
            "                  <span>{point.label}</span>",
            "                </li>",
            "              );",
            "            })}",
            "          </ul>",
            "        </div>",
            "",
            "        <div className=\"motion-rise mt-12 md:mt-16\" style={riseDelay(320)}>",
            "          <HeroStage />",
            "        </div>",
            "      </Container>",
            "    </section>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import * as React from \"react\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { HeroStage } from \"./hero-stage\";",
            "import { AnnouncementBadge } from \"./announcement-badge\";",
            "import { ArrowRight } from \"lucide-react\";",
            "import { Container } from \"@/components/shared/container\";",
            "import { getSellerPortalUrl, getThemeDemoUrl } from \"@/lib/urls\";",
            "",
            "const HERO_TRUST_POINTS = [",
            "  \"COD with WhatsApp verification\",",
            "  \"JazzCash and EasyPaisa\",",
            "  \"Support in Urdu and English\",",
            "] as const;",
            "",
            "export function PremiumHero() {",
            "  return (",
            "    <section aria-labelledby=\"hero-heading\" className=\"relative overflow-hidden bg-background py-(--section-y) md:py-(--section-y-md)\">",
            "      <Container>",
            "        <div className=\"grid grid-cols-1 items-center gap-x-12 gap-y-12 lg:grid-cols-12\">",
            "          <div className=\"flex min-w-0 flex-col items-start lg:col-span-6\">",
            "            <AnnouncementBadge />",
            "",
            "            <h1",
            "              id=\"hero-heading\"",
            "              className=\"motion-title mt-6 font-heading text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] text-balance text-foreground md:text-5xl lg:text-[4rem]\"",
            "            >",
            "              Sell online in Pakistan with Cash on Delivery built in",
            "            </h1>",
            "",
            "            <p className=\"mt-6 max-w-xl text-lead text-muted-foreground text-pretty\">",
            "              Create your own online shop with Cash on Delivery, JazzCash, EasyPaisa and local couriers.",
            "            </p>",
            "",
            "            <div className=\"mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row\">",
            "              <Button asChild size=\"xl\" className=\"w-full gap-2 rounded-full shadow-none sm:w-auto\">",
            "                <a href={getSellerPortalUrl(\"signup\")}>",
            "                  Start free <ArrowRight className=\"size-4\" aria-hidden=\"true\" />",
            "                </a>",
            "              </Button>",
            "              <Button asChild variant=\"outline\" size=\"xl\" className=\"w-full rounded-full shadow-none sm:w-auto\">",
            "                <a href={getThemeDemoUrl()}>See a live store</a>",
            "              </Button>",
            "            </div>",
            "",
            "            <p className=\"mt-4 text-sm text-muted-foreground\">",
            "              Free plan to start. Support in Urdu and English.",
            "            </p>",
            "",
            "            <ul className=\"mt-10 flex w-full flex-col divide-y divide-border border-y border-border text-sm text-muted-foreground sm:w-auto sm:flex-row sm:divide-x sm:divide-y-0\">",
            "              {HERO_TRUST_POINTS.map((label) => (",
            "                <li key={label} className=\"py-3 sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0\">",
            "                  {label}",
            "                </li>",
            "              ))}",
            "            </ul>",
            "          </div>",
            "",
            "          <div className=\"motion-rise min-w-0 lg:col-span-6\">",
            "            <HeroStage />",
            "          </div>",
            "        </div>",
            "      </Container>",
            "    </section>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/hero/hero-stage.tsx",
      "beforeSha": "82e45735b9552b2ec0add4f1e82d24b2ff71e3c01e282b79e9e5588ff194a561",
      "afterSha": "295c12417219ee61b58cd438283339b949960827f21ff5165a79701c6481f24f",
      "edits": [
        {
          "name": "hero stage",
          "expect": 1,
          "before": [
            "import * as React from \"react\";",
            "import { ShoppingBag, Check } from \"lucide-react\";",
            "import { Surface } from \"@/components/shared/surface\";",
            "import { DashboardMockup } from \"@/components/marketing/mockup/dashboard-mockup\";",
            "import { BRAND } from \"@/lib/brand\";",
            "",
            "function HeroPhoneStorefront() {",
            "  return (",
            "    <Surface",
            "      level={3}",
            "      radius=\"3xl\"",
            "      className=\"w-full overflow-hidden border border-border-strong bg-card p-2 shadow-lg\"",
            "    >",
            "      <div className=\"mx-auto mb-1.5 h-1 w-10 rounded-full bg-border\" />",
            "      <div className=\"overflow-hidden rounded-2xl border border-border bg-background\">",
            "        {/* Phone store header */}",
            "        <div className=\"flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2\">",
            "          <span className=\"truncate text-[11px] font-semibold text-foreground\">",
            "            Demo Store",
            "          </span>",
            "          <span className=\"inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary\">",
            "            <ShoppingBag className=\"size-2.5\" aria-hidden=\"true\" />",
            "            2",
            "          </span>",
            "        </div>",
            "",
            "        {/* Featured product card */}",
            "        <div className=\"p-2.5 space-y-2.5\">",
            "          <div className=\"rounded-xl border border-border bg-muted/50 p-2.5\">",
            "            <div className=\"mb-2 flex h-16 items-center justify-center rounded-lg bg-primary/10\">",
            "              <div className=\"h-8 w-12 rounded-md border border-primary/25 bg-card\" />",
            "            </div>",
            "            <div className=\"flex items-center justify-between gap-2\">",
            "              <span className=\"truncate text-[11px] font-medium text-foreground\">",
            "                Lawn Kurta Set",
            "              </span>",
            "              <span className=\"shrink-0 text-[11px] font-semibold tabular-nums text-foreground\">",
            "                Rs. 3,450",
            "              </span>",
            "            </div>",
            "          </div>",
            "",
            "          {/* Payment badges */}",
            "          <div className=\"flex flex-wrap gap-1\">",
            "            <span className=\"rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground\">",
            "              COD",
            "            </span>",
            "            <span className=\"rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground\">",
            "              JazzCash",
            "            </span>",
            "            <span className=\"rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground\">",
            "              EasyPaisa",
            "            </span>",
            "          </div>",
            "",
            "          {/* Order button */}",
            "          <div className=\"flex items-center justify-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground\">",
            "            <Check className=\"size-3\" aria-hidden=\"true\" />",
            "            Order with COD",
            "          </div>",
            "        </div>",
            "      </div>",
            "    </Surface>",
            "  );",
            "}",
            "",
            "export function HeroStage() {",
            "  return (",
            "    <div aria-hidden=\"true\" className=\"relative mx-auto w-full max-w-5xl md:pb-8\">",
            "      <Surface",
            "        level={3}",
            "        className=\"overflow-hidden rounded-2xl border border-border bg-card shadow-lg\"",
            "      >",
            "        <div className=\"flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2.5 sm:px-4 sm:py-3\">",
            "          <div className=\"flex items-center gap-1.5 sm:gap-2\">",
            "            <div className=\"size-2.5 rounded-full bg-destructive/70 sm:size-3\" />",
            "            <div className=\"size-2.5 rounded-full bg-warning/70 sm:size-3\" />",
            "            <div className=\"size-2.5 rounded-full bg-success/70 sm:size-3\" />",
            "          </div>",
            "          <div className=\"min-w-0 truncate rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:px-3\">",
            "            {BRAND.adminPreviewUrl}",
            "          </div>",
            "          <span className=\"shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground\">Sample data</span>",
            "        </div>",
            "        <div className=\"bg-background p-3 sm:p-6 md:pb-10\">",
            "          <DashboardMockup />",
            "        </div>",
            "      </Surface>",
            "",
            "      {/* Phone storefront mockup: overlaps bottom-right corner on md+, hidden below md to keep mobile first screen compact and 360px-safe */}",
            "      <div className=\"hidden md:block md:absolute md:-bottom-2 md:right-4 md:z-20 md:w-56 lg:right-6 lg:w-60 motion-float\">",
            "        <HeroPhoneStorefront />",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import * as React from \"react\";",
            "import { DashboardMockup } from \"@/components/marketing/mockup/dashboard-mockup\";",
            "",
            "/** Right column of the hero: the code-built product panel. Decorative, sample data only. */",
            "export function HeroStage() {",
            "  return (",
            "    <div aria-hidden=\"true\" className=\"relative mx-auto w-full max-w-xl lg:max-w-none\">",
            "      <DashboardMockup />",
            "    </div>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/proof/integrations-marquee.tsx",
      "beforeSha": "2a3df54776752ae98a86a760dfadfeb1323153150dd2483dc4ebaef19dd96ee2",
      "afterSha": "991c2ac381b2655066554303f3d210ac31bfeb472abcfa2777b3dcc140ed51bb",
      "edits": [
        {
          "name": "proof row",
          "expect": 1,
          "before": [
            "import Image from \"next/image\";",
            "import { INTEGRATIONS, type IntegrationItem } from \"@/content/marketing/integrations\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "",
            "/**",
            " * Integrations strip. Shows an official logo only when content/marketing/integrations.ts",
            " * sets logoPath (no file-system reads at render time). Otherwise: icon and name.",
            " */",
            "function IntegrationBadge({ item, compact = false }: { item: IntegrationItem; compact?: boolean }) {",
            "  if (item.logoPath) {",
            "    return (",
            "      <span className=\"inline-flex items-center justify-center grayscale opacity-75 transition-[filter,opacity,color] duration-200 ease-out-expo hover:grayscale-0 hover:opacity-100\">",
            "        <Image src={item.logoPath} alt={item.name} width={112} height={32} className=\"h-7 w-auto object-contain\" />",
            "      </span>",
            "    );",
            "  }",
            "",
            "  const Icon = item.icon;",
            "  return (",
            "    <span className=\"inline-flex items-center justify-center gap-2.5 text-muted-foreground grayscale opacity-80 transition-[filter,opacity,color] duration-200 ease-out-expo hover:grayscale-0 hover:opacity-100 hover:text-foreground\">",
            "      <Icon className=\"size-5 text-primary\" aria-hidden=\"true\" />",
            "      <span className={compact ? \"text-base md:text-lg font-semibold tracking-tight\" : \"text-lg font-semibold tracking-tight\"}>",
            "        {item.name}",
            "      </span>",
            "    </span>",
            "  );",
            "}",
            "",
            "export function IntegrationsMarquee() {",
            "  const repeated = [...INTEGRATIONS, ...INTEGRATIONS];",
            "",
            "  return (",
            "    <Section labelledBy=\"integrations-heading\" className=\"overflow-hidden\" tone=\"muted\">",
            "      <Reveal delay={100}>",
            "        <div className=\"flex flex-col items-center gap-8 md:gap-10\">",
            "          <h2 id=\"integrations-heading\" className=\"text-xs font-semibold uppercase tracking-widest text-muted-foreground text-center\">",
            "            Payments, couriers and WhatsApp, built in",
            "          </h2>",
            "",
            "          <div className=\"relative flex w-full max-w-7xl overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] motion-reduce:mask-none motion-reduce:overflow-visible\">",
            "            {/* Animated marquee (hidden when reduced motion is requested) */}",
            "            <div className=\"flex w-max motion-safe:animate-[marquee_40s_linear_infinite] motion-safe:hover:[animation-play-state:paused] motion-reduce:hidden\">",
            "              {repeated.map((item, i) => (",
            "                <div",
            "                  key={`${item.name}-${i}`}",
            "                  className=\"mx-6 sm:mx-8 flex items-center justify-center shrink-0\"",
            "                  aria-hidden={i >= INTEGRATIONS.length ? \"true\" : undefined}",
            "                >",
            "                  <IntegrationBadge item={item} />",
            "                </div>",
            "              ))}",
            "            </div>",
            "",
            "            {/* Static wrap row (shown only when reduced motion is requested) */}",
            "            <div className=\"hidden motion-reduce:flex flex-wrap justify-center gap-6 sm:gap-10 mx-auto\">",
            "              {INTEGRATIONS.map((item) => (",
            "                <div key={item.name} className=\"flex items-center justify-center shrink-0\">",
            "                  <IntegrationBadge item={item} compact />",
            "                </div>",
            "              ))}",
            "            </div>",
            "          </div>",
            "        </div>",
            "      </Reveal>",
            "    </Section>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import { INTEGRATIONS } from \"@/content/marketing/integrations\";",
            "import { Section } from \"@/components/shared/section\";",
            "",
            "/**",
            " * Proof row: text only. No logos, no marquee, no animation (decision D7).",
            " * Names come from content/marketing/integrations.ts.",
            " */",
            "export function IntegrationsMarquee() {",
            "  return (",
            "    <Section labelledBy=\"integrations-heading\" className=\"py-10 md:py-12\">",
            "      <div className=\"flex flex-col items-center gap-6\">",
            "        <h2 id=\"integrations-heading\" className=\"text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground\">",
            "          Payments, couriers and WhatsApp, built in",
            "        </h2>",
            "        <ul className=\"flex flex-wrap items-center justify-center gap-x-10 gap-y-3\">",
            "          {INTEGRATIONS.map((item) => (",
            "            <li key={item.name} className=\"text-base font-medium text-muted-foreground\">",
            "              {item.name}",
            "            </li>",
            "          ))}",
            "        </ul>",
            "      </div>",
            "    </Section>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/mockup/dashboard-mockup.tsx",
      "beforeSha": "a5707ccc7f69ea482aafab6975318b98a6b04bb11fc9f7ef7cdb7467b1f27f62",
      "afterSha": "23582a47ff7097816e0f991846f5b483a4ba99700cf5346544bb75d2532d9473",
      "edits": [
        {
          "name": "product panel",
          "expect": 1,
          "before": [
            "import { MetricTile } from \"./metric-tile\";",
            "import { LiveOrders } from \"./live-orders\";",
            "import { RevenueChart } from \"./revenue-chart\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "export function DashboardMockup({ className }: { className?: string }) {",
            "  return (",
            "    <div",
            "      aria-hidden=\"true\"",
            "      className={cn(\"relative mx-auto w-full\", className)}",
            "    >",
            "      <div className=\"grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6\">",
            "        <div className=\"flex flex-col gap-4 md:col-span-2 md:gap-6\">",
            "          <div className=\"grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4\">",
            "            <MetricTile",
            "              label=\"Total Store Visitors\"",
            "              value=\"12,482\"",
            "              trend={{ value: \"12%\", isPositive: true }}",
            "            />",
            "            <MetricTile",
            "              label=\"Conversion Rate\"",
            "              value=\"3.2%\"",
            "              trend={{ value: \"0.4%\", isPositive: true }}",
            "            />",
            "          </div>",
            "          <RevenueChart className=\"flex-1\" />",
            "        </div>",
            "",
            "        <div className=\"md:col-span-1\">",
            "          <LiveOrders className=\"h-full\" />",
            "        </div>",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import { MetricTile } from \"./metric-tile\";",
            "import { LiveOrders } from \"./live-orders\";",
            "import { RevenueChart } from \"./revenue-chart\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "const PAYMENTS = [\"JazzCash\", \"EasyPaisa\", \"COD\"] as const;",
            "const COURIERS = [\"TCS\", \"Leopards\", \"Trax\"] as const;",
            "",
            "function Chip({ children }: { children: React.ReactNode }) {",
            "  return (",
            "    <span className=\"inline-flex h-6 items-center rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground\">",
            "      {children}",
            "    </span>",
            "  );",
            "}",
            "",
            "/**",
            " * ProductMock: a code-built panel of today's orders, payments and couriers.",
            " * Decorative and aria-hidden. Every value is sample data in PKR.",
            " */",
            "export function DashboardMockup({ className }: { className?: string }) {",
            "  return (",
            "    <div",
            "      aria-hidden=\"true\"",
            "      className={cn(\"w-full overflow-hidden rounded-lg border border-border bg-surface-1\", className)}",
            "    >",
            "      <div className=\"flex items-center justify-between border-b border-border px-4 py-3\">",
            "        <span className=\"text-sm font-medium text-foreground\">Today</span>",
            "        <span className=\"text-xs text-muted-foreground\">Sample data</span>",
            "      </div>",
            "",
            "      <div className=\"grid grid-cols-2 divide-x divide-border border-b border-border\">",
            "        <MetricTile label=\"Orders today\" value=\"24\" trend={{ value: \"8%\", isPositive: true }} />",
            "        <MetricTile label=\"WhatsApp verified\" value=\"21 of 24\" />",
            "      </div>",
            "",
            "      <RevenueChart className=\"border-b border-border\" />",
            "",
            "      <LiveOrders className=\"border-b border-border\" />",
            "",
            "      <div className=\"grid gap-4 px-4 py-4 sm:grid-cols-2\">",
            "        <div>",
            "          <p className=\"text-xs text-muted-foreground\">Payments</p>",
            "          <div className=\"mt-2 flex flex-wrap gap-1.5\">",
            "            {PAYMENTS.map((name) => (",
            "              <Chip key={name}>{name}</Chip>",
            "            ))}",
            "          </div>",
            "        </div>",
            "        <div>",
            "          <p className=\"text-xs text-muted-foreground\">Couriers</p>",
            "          <div className=\"mt-2 flex flex-wrap gap-1.5\">",
            "            {COURIERS.map((name) => (",
            "              <Chip key={name}>{name}</Chip>",
            "            ))}",
            "          </div>",
            "        </div>",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            "",
            "export { DashboardMockup as ProductMock };",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/mockup/live-orders.tsx",
      "beforeSha": "a310488d5176a6361d4dd80935f6f2832c049f4d9383e31ce4156597558407e4",
      "afterSha": "ea12e9dc73dee838dcfc7900072296fe4841a0f36a5a12a90b56674bd0302ea7",
      "edits": [
        {
          "name": "orders list",
          "expect": 1,
          "before": [
            "import { cn } from \"@/lib/utils\";",
            "",
            "export function LiveOrders({ className }: { className?: string }) {",
            "  const formatPKR = (amount: number) => \"Rs. \" + amount.toLocaleString(\"en-PK\", { minimumFractionDigits: 0, maximumFractionDigits: 0 });",
            "",
            "  const orders = [",
            "    { id: \"ORD-7291\", customer: \"Ahmad K.\", amount: 4250, status: \"completed\", time: \"2m ago\" },",
            "    { id: \"ORD-7290\", customer: \"Sarah M.\", amount: 12800, status: \"processing\", time: \"15m ago\" },",
            "    { id: \"ORD-7289\", customer: \"Usman A.\", amount: 2100, status: \"completed\", time: \"1h ago\" },",
            "    { id: \"ORD-7288\", customer: \"Fatima R.\", amount: 8400, status: \"completed\", time: \"2h ago\" },",
            "    { id: \"ORD-7287\", customer: \"Ali B.\", amount: 3150, status: \"processing\", time: \"2h ago\" },",
            "  ];",
            "",
            "  return (",
            "    <div className={cn(\"flex flex-col rounded-md border border-border bg-background shadow-xs overflow-hidden\", className)}>",
            "      <div className=\"border-b border-border bg-muted/30 px-4 py-3 flex items-center justify-between\">",
            "        <span className=\"text-[11px] font-semibold text-foreground uppercase tracking-wider\">Live Orders</span>",
            "        <div className=\"flex items-center gap-1.5\">",
            "          <span className=\"relative flex size-1.5\">",
            "            <span className=\"absolute inline-flex h-full w-full motion-safe:animate-[ping_1s_cubic-bezier(0,0,0.2,1)_3_forwards] rounded-full bg-success opacity-75\" />",
            "            <span className=\"relative inline-flex size-1.5 rounded-full bg-success\" />",
            "          </span>",
            "          <span className=\"text-[10px] text-muted-foreground\">SYNCED</span>",
            "        </div>",
            "      </div>",
            "      <div className=\"flex flex-col divide-y divide-border\">",
            "        {orders.map((order) => (",
            "          <div key={order.id} className=\"flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors\">",
            "            <div className=\"flex flex-col gap-0.5\">",
            "              <span className=\"text-[11px] font-medium text-foreground\">{order.customer}</span>",
            "              <span className=\"text-[10px] text-muted-foreground\">{order.id} &bull; {order.time}</span>",
            "            </div>",
            "            <div className=\"flex flex-col items-end gap-1\">",
            "              <span className=\"text-[11px] font-semibold text-foreground tabular-nums\">{formatPKR(order.amount)}</span>",
            "              {order.status === \"completed\" ? (",
            "                <span className=\"text-[9px] font-medium text-success uppercase tracking-wider flex items-center gap-1\">",
            "                  <span className=\"size-1.5 rounded-full bg-success\" />",
            "                  Completed",
            "                </span>",
            "              ) : (",
            "                <span className=\"text-[9px] font-medium text-primary uppercase tracking-wider flex items-center gap-1\">",
            "                  <span className=\"size-1.5 rounded-full bg-primary\" />",
            "                  Processing",
            "                </span>",
            "              )}",
            "            </div>",
            "          </div>",
            "        ))}",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import { cn } from \"@/lib/utils\";",
            "",
            "const formatPKR = (amount: number) =>",
            "  \"Rs. \" + amount.toLocaleString(\"en-PK\", { minimumFractionDigits: 0, maximumFractionDigits: 0 });",
            "",
            "const ORDERS = [",
            "  { id: \"MZ-7291\", city: \"Lahore\", amount: 4250, payment: \"COD\", verified: true, dispatched: true },",
            "  { id: \"MZ-7290\", city: \"Karachi\", amount: 12800, payment: \"JazzCash\", verified: true, dispatched: false },",
            "  { id: \"MZ-7289\", city: \"Islamabad\", amount: 2100, payment: \"COD\", verified: false, dispatched: false },",
            "  { id: \"MZ-7288\", city: \"Faisalabad\", amount: 8400, payment: \"EasyPaisa\", verified: true, dispatched: true },",
            "] as const;",
            "",
            "const CHIP = \"inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium\";",
            "",
            "export function LiveOrders({ className }: { className?: string }) {",
            "  return (",
            "    <div className={cn(\"flex flex-col\", className)}>",
            "      <div className=\"flex items-center justify-between border-b border-border px-4 py-3\">",
            "        <span className=\"text-xs text-muted-foreground\">Live orders</span>",
            "        <div className=\"flex items-center gap-1.5\">",
            "          <span className=\"size-1.5 rounded-full bg-success\" />",
            "          <span className=\"text-xs text-muted-foreground\">Synced</span>",
            "        </div>",
            "      </div>",
            "      <ul className=\"flex flex-col divide-y divide-border\">",
            "        {ORDERS.map((order) => (",
            "          <li key={order.id} className=\"flex items-start justify-between gap-3 px-4 py-3\">",
            "            <div className=\"min-w-0\">",
            "              <div className=\"flex items-baseline gap-2\">",
            "                <span className=\"font-mono text-[13px] font-medium text-foreground\">#{order.id}</span>",
            "                <span className=\"truncate text-xs text-muted-foreground\">{order.city}</span>",
            "              </div>",
            "              <div className=\"mt-2 flex flex-wrap gap-1.5\">",
            "                <span className={cn(CHIP, \"border border-border bg-background text-muted-foreground\")}>{order.payment}</span>",
            "                {order.verified ? (",
            "                  <span className={cn(CHIP, \"bg-success-subtle text-success-subtle-foreground\")}>WhatsApp verified</span>",
            "                ) : (",
            "                  <span className={cn(CHIP, \"bg-warning-subtle text-warning-subtle-foreground\")}>Awaiting reply</span>",
            "                )}",
            "                {order.dispatched && (",
            "                  <span className={cn(CHIP, \"bg-info-subtle text-info-subtle-foreground\")}>Dispatched</span>",
            "                )}",
            "              </div>",
            "            </div>",
            "            <span className=\"shrink-0 text-sm font-medium tabular-nums text-foreground\">{formatPKR(order.amount)}</span>",
            "          </li>",
            "        ))}",
            "      </ul>",
            "    </div>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/mockup/metric-tile.tsx",
      "beforeSha": "41ff734de34d0ed1824819df3a86da3575f489573b2aa5b573f2d61ac715d0c9",
      "afterSha": "3a0f76e40c60fda7e5631f1599db3b1f0cde553f153554787587d727610a266e",
      "edits": [
        {
          "name": "metric tile",
          "expect": 1,
          "before": [
            "export function MetricTile({ label, value, trend, className }: MetricTileProps) {",
            "  return (",
            "    <div className={cn(\"flex flex-col gap-1 rounded-md border border-border bg-background p-4 shadow-xs\", className)}>",
            "      <span className=\"text-[11px] font-medium text-muted-foreground uppercase tracking-wider\">{label}</span>",
            "      <div className=\"flex items-end justify-between mt-1\">",
            "        <span className=\"text-xl font-bold text-foreground tabular-nums tracking-tight\">{value}</span>",
            "        {trend && (",
            "          <span ",
            "            className={cn(",
            "              \"text-[10px] font-medium tabular-nums\",",
            "              trend.isPositive ? \"text-success\" : \"text-destructive\"",
            "            )}",
            "          >",
            "            {trend.isPositive ? \"+\" : \"-\"}{trend.value}",
            "          </span>",
            "        )}",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "export function MetricTile({ label, value, trend, className }: MetricTileProps) {",
            "  return (",
            "    <div className={cn(\"flex min-w-0 flex-col gap-1 p-4\", className)}>",
            "      <span className=\"text-xs text-muted-foreground\">{label}</span>",
            "      <div className=\"mt-1 flex items-end justify-between gap-2\">",
            "        <span className=\"text-xl font-semibold tabular-nums tracking-tight text-foreground\">{value}</span>",
            "        {trend && (",
            "          <span",
            "            className={cn(",
            "              \"text-xs font-medium tabular-nums\",",
            "              trend.isPositive ? \"text-success-subtle-foreground\" : \"text-destructive-subtle-foreground\"",
            "            )}",
            "          >",
            "            {trend.isPositive ? \"+\" : \"-\"}{trend.value}",
            "          </span>",
            "        )}",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/mockup/revenue-chart.tsx",
      "beforeSha": "576c0b016644895713e9f6527f89d5b9343fe995a3c00caa259af28e902cb053",
      "afterSha": "c5e6a354c0a2343e9dd6028c8620bd516c8addaa1dd6210f39571931d73bc086",
      "edits": [
        {
          "name": "chart container",
          "expect": 1,
          "before": [
            "className={cn(\"flex flex-col rounded-md border border-border bg-background p-4 shadow-xs\", className)}"
          ],
          "after": [
            "className={cn(\"flex flex-col p-4\", className)}"
          ]
        },
        {
          "name": "chart label",
          "expect": 1,
          "before": [
            "className=\"text-[11px] font-medium text-muted-foreground uppercase tracking-wider\""
          ],
          "after": [
            "className=\"text-xs text-muted-foreground\""
          ]
        },
        {
          "name": "chart value",
          "expect": 1,
          "before": [
            "className=\"text-xl font-bold text-foreground tabular-nums\""
          ],
          "after": [
            "className=\"text-xl font-semibold text-foreground tabular-nums tracking-tight\""
          ]
        },
        {
          "name": "chart delta",
          "expect": 1,
          "before": [
            "className=\"text-[10px] font-medium text-success bg-success/15 px-2 py-1 rounded-sm\""
          ],
          "after": [
            "className=\"rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success-subtle-foreground\""
          ]
        },
        {
          "name": "chart height",
          "expect": 1,
          "before": [
            "className=\"relative h-32 w-full mt-auto\""
          ],
          "after": [
            "className=\"relative mb-4 h-24 w-full mt-auto\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/app/globals.css",
      "beforeSha": "56f752d6b63747cdceadffd4d37e34349d5b7bdcd7adc08f38651b36577ce672",
      "afterSha": "186d0e6cf0af0b1ee9091d802b83b28b02b7f0b01f5dca48ff139b93adfa2df1",
      "edits": [
        {
          "name": "rise-in 250ms",
          "expect": 1,
          "before": [
            "animation: motion-rise var(--dur-slow) var(--ease-out-expo) backwards;"
          ],
          "after": [
            "animation: motion-rise var(--dur-base) var(--ease-out-expo) backwards;"
          ]
        },
        {
          "name": "title rise-in 250ms",
          "expect": 1,
          "before": [
            "animation: motion-title var(--dur-slow) var(--ease-out-expo) backwards;"
          ],
          "after": [
            "animation: motion-title var(--dur-base) var(--ease-out-expo) backwards;"
          ]
        },
        {
          "name": "title comment",
          "expect": 1,
          "before": [
            "opacity is 1 by half the duration (250ms)."
          ],
          "after": [
            "opacity is 1 by half the duration (125ms)."
          ]
        },
        {
          "name": "remove float rule (D7)",
          "expect": 1,
          "before": [
            "",
            "  /* Hero phone mockup: slow float, 6px travel, desktop only. */",
            "  .motion-float {",
            "    animation: motion-float 6s ease-in-out infinite;",
            "  }",
            ""
          ],
          "after": [
            ""
          ]
        },
        {
          "name": "remove float keyframes (D7)",
          "expect": 1,
          "before": [
            "@keyframes motion-float {",
            "  0%,",
            "  100% {",
            "    transform: translateY(0);",
            "  }",
            "  50% {",
            "    transform: translateY(-6px);",
            "  }",
            "}",
            "",
            ""
          ],
          "after": [
            ""
          ]
        }
      ]
    }
  ],
  "create": [

  ]
};
const PHASE = M.phase;
const NOTES = M.notes;
const BACKUP = path.join(here, ".backup", PHASE);
const MANIFEST_FILE = path.join(BACKUP, "manifest.json");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const toLF = (s) => s.replace(/\r\n/g, "\n");
const lines = (a) => a.join("\n");
const abs = (rel) => path.join(ROOT, ...rel.split("/"));
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const flag = process.argv.slice(2).find((a) => ["--dry-run", "--apply", "--verify", "--revert"].includes(a));

const globToRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
const inAllowlist = (rel) => M.allow.some((g) => globToRe(g).test(rel));

function plan() {
  const rows = [];
  for (const f of M.modify) {
    const file = abs(f.rel);
    const row = { rel: f.rel, kind: "modify", matched: 0, total: f.edits.length, status: "", out: null, raw: null };
    if (!fs.existsSync(file)) { row.status = "BLOCKED: file not found"; rows.push(row); continue; }
    const raw = fs.readFileSync(file, "utf8");
    row.raw = raw;
    const norm = toLF(raw);
    const h = sha(norm);
    if (h === f.afterSha) { row.matched = row.total; row.status = "already applied"; rows.push(row); continue; }
    let text = norm;
    const bad = [];
    for (const e of f.edits) {
      const before = lines(e.before);
      const n = count(norm, before);
      if (n === e.expect) row.matched++; else bad.push(`${e.name} (found ${n}, expected ${e.expect})`);
    }
    if (bad.length) { row.status = "BLOCKED: anchor missing: " + bad.join("; "); rows.push(row); continue; }
    if (h !== f.beforeSha) { row.status = `BLOCKED: file differs from the expected copy (sha256 ${h.slice(0, 12)}, expected ${f.beforeSha.slice(0, 12)})`; rows.push(row); continue; }
    for (const e of f.edits) text = text.split(lines(e.before)).join(lines(e.after));
    if (sha(text) !== f.afterSha) { row.status = "BLOCKED: computed result does not match its checksum"; rows.push(row); continue; }
    row.out = raw.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
    row.status = "ready";
    rows.push(row);
  }
  for (const f of M.create) {
    const file = abs(f.rel);
    const content = lines(f.lines);
    const row = { rel: f.rel, kind: "create", matched: 0, total: 1, status: "", out: content };
    if (fs.existsSync(file)) {
      if (sha(toLF(fs.readFileSync(file, "utf8"))) === sha(content)) { row.matched = 1; row.status = "already applied"; }
      else row.status = "BLOCKED: exists with different content";
    } else { row.matched = 1; row.status = "ready"; }
    rows.push(row);
  }
  const applied = rows.filter((r) => r.status === "already applied").length;
  if (applied > 0 && applied < rows.length && !rows.some((r) => r.status.startsWith("BLOCKED"))) {
    rows.forEach((r) => { if (r.status === "ready") r.status = "BLOCKED: partially applied (other files are already applied)"; });
  }
  return rows;
}

function report(title, rows) {
  console.log(`patch_redesign_${PHASE}  ${title}`);
  NOTES.forEach((n) => console.log("NOTE  " + n));
  const w = Math.max(...rows.map((r) => r.rel.length));
  for (const r of rows) {
    console.log(`${r.rel.padEnd(w)}  ${r.kind === "create" ? "new file " : "anchors  "}${r.matched} of ${r.total}  ${r.status}`);
  }
  const blocked = rows.some((r) => r.status.startsWith("BLOCKED"));
  console.log(blocked ? "RESULT: BLOCKED" : "RESULT: OK");
  return !blocked;
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".p0tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function apply() {
  const rows = plan();
  if (rows.every((r) => r.status === "already applied")) { report("--apply", rows); return true; }
  if (rows.some((r) => r.status.startsWith("BLOCKED"))) { report("--apply", rows); return false; }
  const outside = rows.filter((r) => !inAllowlist(r.rel));
  if (outside.length) { outside.forEach((r) => (r.status = "BLOCKED: outside the phase allowlist")); report("--apply", rows); return false; }
  // Pass 2: back up, then write. Roll back on any error.
  fs.mkdirSync(BACKUP, { recursive: true });
  const manifest = { phase: PHASE, modified: [], created: [] };
  const todo = rows.filter((r) => r.status === "ready");
  try {
    for (const r of todo) {
      if (r.kind === "modify") {
        const dest = path.join(BACKUP, ...r.rel.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, r.raw);
        manifest.modified.push(r.rel);
      } else manifest.created.push(r.rel);
    }
    writeAtomic(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
    for (const r of todo) writeAtomic(abs(r.rel), r.out);
    todo.forEach((r) => (r.status = "applied"));
  } catch (err) {
    console.log("ERROR during write: " + err.message + ". Rolling back.");
    restore(manifest);
    todo.forEach((r) => (r.status = "BLOCKED: write failed, rolled back"));
  }
  return report("--apply", rows);
}

function restore(manifest) {
  for (const rel of manifest.modified) {
    const src = path.join(BACKUP, ...rel.split("/"));
    if (fs.existsSync(src)) writeAtomic(abs(rel), fs.readFileSync(src));
  }
  for (const rel of manifest.created) {
    const f = abs(rel);
    if (fs.existsSync(f)) fs.rmSync(f);
    const dir = path.dirname(f);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function revert() {
  console.log(`patch_redesign_${PHASE}  --revert`);
  if (!fs.existsSync(MANIFEST_FILE)) { console.log("Nothing to revert: no backup manifest."); console.log("RESULT: OK"); return true; }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  restore(manifest);
  fs.renameSync(MANIFEST_FILE, path.join(BACKUP, "manifest.reverted.json"));
  manifest.modified.forEach((r) => console.log(`restored  ${r}`));
  manifest.created.forEach((r) => console.log(`removed   ${r}`));
  console.log("RESULT: OK");
  return true;
}

function node(script, args = []) {
  const file = path.join(SF, "scripts", script);
  if (!fs.existsSync(file)) return { ok: false, out: "missing " + script };
  const r = spawnSync(process.execPath, [file, ...args], { cwd: SF, encoding: "utf8" });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

function verify() {
  console.log(`patch_redesign_${PHASE}  --verify`);
  let ok = true;
  const line = (name, pass, detail = "") => {
    if (pass === false) ok = false;
    console.log(`${pass === null ? "SKIP" : pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  };
  const rows = plan();
  for (const r of rows) line(`applied: ${r.rel}`, r.status === "already applied", r.status === "already applied" ? "" : r.status);
  const guards = [
    ["check:tokens", "check-tokens.mjs", []],
    ["check:classes", "check-classes.mjs", []],
    ["check:contrast", "check-contrast.mjs", []],
    ["check:flat (report-only)", "check-flat.mjs", []],
  ];
  for (const [name, script, args] of guards) {
    const r = node(script, args);
    line(name, r.ok, r.ok ? r.out.split("\n").pop() : "\n" + r.out.split("\n").slice(-12).join("\n"));
  }
  const outsideAll = [...M.modify.map((f) => f.rel), ...M.create.map((f) => f.rel)].filter((r) => !inAllowlist(r));
  line("scope: every target is inside the " + PHASE + " allowlist", outsideAll.length === 0, outsideAll.join(", "));
  const tsc = [path.join(SF, "node_modules", "typescript", "bin", "tsc"), path.join(ROOT, "node_modules", "typescript", "bin", "tsc")].find((p) => fs.existsSync(p));
  if (!tsc) line("type-check", null, "dependencies are not installed (run pnpm install, then pnpm --filter @markaz/storefront type-check)");
  else {
    const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", path.join(SF, "tsconfig.json")], { cwd: SF, encoding: "utf8" });
    line("type-check", r.status === 0, r.status === 0 ? "" : "\n" + (r.stdout || r.stderr).split("\n").slice(0, 15).join("\n"));
  }
  (M.manual || []).forEach((m) => console.log("MANUAL  " + m));
  console.log(ok ? "RESULT: OK" : "RESULT: BLOCKED");
  return ok;
}

let ok;
if (flag === "--dry-run") { const rows = plan(); ok = report("--dry-run (nothing written)", rows); }
else if (flag === "--apply") ok = apply();
else if (flag === "--verify") ok = verify();
else if (flag === "--revert") ok = revert();
else { console.log("Usage: node patch_redesign_" + PHASE + ".mjs --dry-run | --apply | --verify | --revert"); ok = false; }
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
// apps/storefront/REDESIGNSCRIPTS/patch_redesign_P3_P6.mjs
//
// Markazify redesign, phase P3_P6: marketing content (P3) and storefront hardening (P6)
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
  "phase": "P3_P6",
  "strictFlat": true,
  "allow": [
    "apps/storefront/components/marketing/**",
    "apps/storefront/components/shared/**",
    "apps/storefront/components/ui/**",
    "apps/storefront/app/(marketing)/**",
    "apps/storefront/scripts/**",
    "apps/storefront/package.json"
  ],
  "notes": [
    "Combined run: P3 (marketing content) plus the storefront part of P6. Seller, admin, design-system and root files are not touched.",
    "M05 adds one text link, 'Learn more' (to /features), to each value row. Review that label.",
    "M07: no theme has a real screenshot yet, so each card shows a neutral wireframe. See 'Screenshots to take' in my reply. The wireframe is no longer a fake mock of a specific theme.",
    "M08: plans are now one hairline table. BillingToggle is restyled but still not rendered anywhere (there are no annual prices), so there is no toggle to test.",
    "M11: PageHeader is unchanged. No inner page needs an action, so I did not add that prop.",
    "X01: resting shadows removed from Surface, Card, Button, BrandMark and BillingToggle. Only floating layers keep shadows. The storefront has no clay names and no duplicate ui files.",
    "X03: scripts/a11y-axe.mjs is added but not run. It needs playwright and @axe-core/playwright (see the file header).",
    "X04: removed 'use client' from ui/separator, ui/sheet and ui/toggle (no hooks, no browser APIs). Everything else needs it.",
    "Not done: X02 (version alignment) and the root package.json cleanup, because they involve apps outside the storefront."
  ],
  "manual": [
    "Pricing: the plan table has no toggle today. Check both plan CTAs go to seller signup.",
    "FAQ keyboard: Tab to a question, Enter or Space opens and closes it, focus ring is visible, no focus is lost.",
    "Run: node apps/storefront/scripts/a11y-axe.mjs (after adding the dev tools) and send me the output.",
    "Run: pnpm --filter @markaz/storefront check:shadows (strict, must PASS)."
  ],
  "modify": [
    {
      "rel": "apps/storefront/components/marketing/features/pk-value-rows.tsx",
      "beforeSha": "f5067b55847abe68d0251a786d1efceba24569c6c39ecbd6086811b53d960f09",
      "afterSha": "7167585201c793600a6237e338b94f4ed8b91e195fc4ddc6cb9d32e5bcff4496",
      "edits": [
        {
          "name": "split value rows",
          "expect": 1,
          "before": [
            "import * as React from \"react\";",
            "import { Check, MessageCircle, Wallet, Truck, ShoppingBag } from \"lucide-react\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { Card } from \"@/components/shared/card\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { staggerDelay } from \"@/components/shared/motion\";",
            "import {",
            "  PK_VALUE_ROWS,",
            "  PAYMENT_AND_COURIER_CHIPS,",
            "  type PkValueVisualKind,",
            "} from \"@/content/marketing/features\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "function CodWhatsappVisual() {",
            "  return (",
            "    <Card padding=\"md\" className=\"w-full max-w-md mx-auto\">",
            "      <div className=\"flex items-center justify-between gap-3 border-b border-border pb-3.5\">",
            "        <div className=\"flex items-center gap-2.5 min-w-0\">",
            "          <span className=\"flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary\">",
            "            <MessageCircle className=\"size-4\" aria-hidden=\"true\" />",
            "          </span>",
            "          <div className=\"min-w-0\">",
            "            <p className=\"truncate text-sm font-semibold text-foreground\">",
            "              WhatsApp Order Check",
            "            </p>",
            "            <p className=\"truncate text-xs text-muted-foreground\">",
            "              Order #ORD-7291 &middot; Rs. 4,250 (COD)",
            "            </p>",
            "          </div>",
            "        </div>",
            "        <span className=\"inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success\">",
            "          <Check className=\"size-3\" aria-hidden=\"true\" />",
            "          Verified",
            "        </span>",
            "      </div>",
            "",
            "      <div className=\"mt-4 flex flex-col gap-2.5 text-xs sm:text-sm\">",
            "        <div className=\"max-w-[88%] self-start rounded-2xl rounded-tl-sm border border-border bg-muted/60 px-3.5 py-2.5 text-foreground\">",
            "          Salam Ahmad! We received your COD order of Rs. 4,250 at Demo Store. Reply YES to confirm dispatch.",
            "        </div>",
            "        <div className=\"w-fit self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 font-medium text-primary-foreground\">",
            "          YES, confirm my order",
            "        </div>",
            "        <div className=\"max-w-[88%] self-start rounded-2xl rounded-tl-sm border border-border bg-muted/60 px-3.5 py-2 text-muted-foreground\">",
            "          Shukriya! Your order is confirmed and ready for courier pickup.",
            "        </div>",
            "      </div>",
            "    </Card>",
            "  );",
            "}",
            "",
            "function PaymentsCouriersVisual() {",
            "  return (",
            "    <Card padding=\"md\" className=\"w-full max-w-md mx-auto\">",
            "      <div className=\"flex items-center justify-between border-b border-border pb-3\">",
            "        <span className=\"text-xs font-semibold uppercase tracking-wider text-muted-foreground\">",
            "          Checkout & Dispatch",
            "        </span>",
            "        <span className=\"text-xs font-medium text-primary\">PKR Native</span>",
            "      </div>",
            "",
            "      <div className=\"mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3\">",
            "        {PAYMENT_AND_COURIER_CHIPS.map((chip) => {",
            "          const isPayment = chip.group === \"Payment\";",
            "          const Icon = isPayment ? Wallet : Truck;",
            "          return (",
            "            <div",
            "              key={chip.label}",
            "              className=\"flex flex-col justify-between gap-2 rounded-xl border border-border bg-muted/50 p-3\"",
            "            >",
            "              <div className=\"flex items-center justify-between\">",
            "                <span className=\"text-[11px] font-medium text-muted-foreground\">",
            "                  {chip.group}",
            "                </span>",
            "                <Icon className=\"size-3.5 text-primary\" aria-hidden=\"true\" />",
            "              </div>",
            "              <span className=\"text-sm font-semibold text-foreground\">",
            "                {chip.label}",
            "              </span>",
            "            </div>",
            "          );",
            "        })}",
            "      </div>",
            "    </Card>",
            "  );",
            "}",
            "",
            "function MobileStoreVisual() {",
            "  return (",
            "    <div className=\"mx-auto w-full max-w-[260px]\">",
            "      <Card padding=\"sm\" className=\"rounded-3xl border-border-strong\">",
            "        <div className=\"mx-auto mb-2 h-1 w-12 rounded-full bg-border\" />",
            "        <div className=\"overflow-hidden rounded-2xl border border-border bg-background\">",
            "          <div className=\"flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2\">",
            "            <span className=\"text-xs font-semibold text-foreground\">Noor Threads</span>",
            "            <span className=\"inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary\">",
            "              <ShoppingBag className=\"size-3\" aria-hidden=\"true\" />",
            "              Rs. 2,800",
            "            </span>",
            "          </div>",
            "          <div className=\"p-3 space-y-2.5\">",
            "            <div className=\"grid grid-cols-2 gap-2\">",
            "              <div className=\"rounded-lg border border-border bg-muted/50 p-2\">",
            "                <div className=\"h-12 rounded-md bg-primary/10 mb-1.5\" />",
            "                <div className=\"text-[11px] font-medium text-foreground truncate\">Cotton Shawl</div>",
            "                <div className=\"text-[10px] font-semibold text-muted-foreground tabular-nums\">Rs. 1,400</div>",
            "              </div>",
            "              <div className=\"rounded-lg border border-border bg-muted/50 p-2\">",
            "                <div className=\"h-12 rounded-md bg-primary/15 mb-1.5\" />",
            "                <div className=\"text-[11px] font-medium text-foreground truncate\">Khaddar Suit</div>",
            "                <div className=\"text-[10px] font-semibold text-muted-foreground tabular-nums\">Rs. 2,800</div>",
            "              </div>",
            "            </div>",
            "            <div className=\"rounded-lg bg-primary py-2 text-center text-xs font-semibold text-primary-foreground\">",
            "              Complete Order (COD / JazzCash)",
            "            </div>",
            "          </div>",
            "        </div>",
            "      </Card>",
            "    </div>",
            "  );",
            "}",
            "",
            "function RowVisual({ kind }: { kind: PkValueVisualKind }) {",
            "  if (kind === \"cod-whatsapp\") return <CodWhatsappVisual />;",
            "  if (kind === \"payments-couriers\") return <PaymentsCouriersVisual />;",
            "  return <MobileStoreVisual />;",
            "}",
            "",
            "export function PkValueRows() {",
            "  return (",
            "    <Section id=\"features\" labelledBy=\"pk-features-heading\">",
            "      <SectionHeading",
            "        id=\"pk-features-heading\"",
            "        eyebrow=\"Built for Pakistan\"",
            "        title=\"Everything a Pakistani online store needs on day one\"",
            "        lead=\"No foreign plugins or complicated workarounds. Verify Cash on Delivery orders, collect local wallet payments, and ship across the country.\"",
            "        align=\"center\"",
            "      />",
            "",
            "      <div className=\"flex flex-col gap-12 md:gap-20\">",
            "        {PK_VALUE_ROWS.map((row, index) => {",
            "          const isReversed = index % 2 === 1;",
            "          return (",
            "            <Reveal",
            "              key={row.id}",
            "              delay={100 + staggerDelay(index, 80)}",
            "              className=\"grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12\"",
            "            >",
            "              <div",
            "                className={cn(",
            "                  \"flex flex-col gap-4 lg:col-span-6\",",
            "                  isReversed && \"lg:order-2\"",
            "                )}",
            "              >",
            "                <p className=\"text-xs font-semibold uppercase tracking-widest text-primary\">",
            "                  {row.eyebrow}",
            "                </p>",
            "                <h3 className=\"font-heading text-h2-sm font-semibold tracking-tight text-balance\">",
            "                  {row.title}",
            "                </h3>",
            "                <p className=\"text-body text-muted-foreground leading-relaxed\">",
            "                  {row.description}",
            "                </p>",
            "                <ul className=\"mt-2 flex flex-col gap-2.5\">",
            "                  {row.bullets.map((bullet) => (",
            "                    <li key={bullet} className=\"flex items-start gap-2.5 text-sm text-foreground\">",
            "                      <span className=\"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary\">",
            "                        <Check className=\"size-3\" aria-hidden=\"true\" />",
            "                      </span>",
            "                      <span>{bullet}</span>",
            "                    </li>",
            "                  ))}",
            "                </ul>",
            "              </div>",
            "",
            "              <div",
            "                aria-hidden=\"true\"",
            "                className={cn(",
            "                  \"lg:col-span-6\",",
            "                  isReversed && \"lg:order-1\"",
            "                )}",
            "              >",
            "                <RowVisual kind={row.visual} />",
            "              </div>",
            "            </Reveal>",
            "          );",
            "        })}",
            "      </div>",
            "    </Section>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import * as React from \"react\";",
            "import Link from \"next/link\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { Card } from \"@/components/shared/card\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { staggerDelay } from \"@/components/shared/motion\";",
            "import {",
            "  PK_VALUE_ROWS,",
            "  PAYMENT_AND_COURIER_CHIPS,",
            "  type PkValueVisualKind,",
            "} from \"@/content/marketing/features\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "function CodWhatsappVisual() {",
            "  return (",
            "    <Card padding=\"md\" className=\"w-full max-w-md\">",
            "      <div className=\"flex items-center justify-between gap-3 border-b border-border pb-3.5\">",
            "        <div className=\"min-w-0\">",
            "          <p className=\"truncate text-sm font-medium text-foreground\">WhatsApp Order Check</p>",
            "          <p className=\"truncate text-xs text-muted-foreground\">",
            "            Order <span className=\"font-mono\">#ORD-7291</span> &middot; Rs. 4,250 (COD)",
            "          </p>",
            "        </div>",
            "        <span className=\"inline-flex h-6 shrink-0 items-center rounded-full bg-success-subtle px-2.5 text-xs font-medium text-success-subtle-foreground\">",
            "          Verified",
            "        </span>",
            "      </div>",
            "",
            "      <div className=\"mt-4 flex flex-col gap-2.5 text-xs sm:text-sm\">",
            "        <div className=\"max-w-[88%] self-start rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-foreground\">",
            "          Salam Ahmad! We received your COD order of Rs. 4,250 at Demo Store. Reply YES to confirm dispatch.",
            "        </div>",
            "        <div className=\"w-fit self-end rounded-lg bg-primary px-3.5 py-2 font-medium text-primary-foreground\">",
            "          YES, confirm my order",
            "        </div>",
            "        <div className=\"max-w-[88%] self-start rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-muted-foreground\">",
            "          Shukriya! Your order is confirmed and ready for courier pickup.",
            "        </div>",
            "      </div>",
            "    </Card>",
            "  );",
            "}",
            "",
            "function PaymentsCouriersVisual() {",
            "  return (",
            "    <Card padding=\"md\" className=\"w-full max-w-md\">",
            "      <div className=\"flex items-center justify-between border-b border-border pb-3\">",
            "        <span className=\"text-xs text-muted-foreground\">Checkout &amp; Dispatch</span>",
            "        <span className=\"text-xs text-muted-foreground\">PKR Native</span>",
            "      </div>",
            "",
            "      <div className=\"mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3\">",
            "        {PAYMENT_AND_COURIER_CHIPS.map((chip) => (",
            "          <div",
            "            key={chip.label}",
            "            className=\"flex flex-col justify-between gap-2 rounded-md border border-border bg-surface-2 p-3\"",
            "          >",
            "            <span className=\"text-xs text-muted-foreground\">{chip.group}</span>",
            "            <span className=\"text-sm font-medium text-foreground\">{chip.label}</span>",
            "          </div>",
            "        ))}",
            "      </div>",
            "    </Card>",
            "  );",
            "}",
            "",
            "function MobileStoreVisual() {",
            "  return (",
            "    <div className=\"w-full max-w-[260px]\">",
            "      <Card padding=\"sm\" className=\"rounded-3xl border-border-strong\">",
            "        <div className=\"mx-auto mb-2 h-1 w-12 rounded-full bg-border\" />",
            "        <div className=\"overflow-hidden rounded-2xl border border-border bg-background\">",
            "          <div className=\"flex items-center justify-between border-b border-border bg-surface-1 px-3 py-2\">",
            "            <span className=\"text-xs font-medium text-foreground\">Noor Threads</span>",
            "            <span className=\"inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums\">",
            "              Rs. 2,800",
            "            </span>",
            "          </div>",
            "          <div className=\"space-y-2.5 p-3\">",
            "            <div className=\"grid grid-cols-2 gap-2\">",
            "              <div className=\"rounded-md border border-border bg-surface-1 p-2\">",
            "                <div className=\"mb-1.5 h-12 rounded-sm bg-secondary\" />",
            "                <div className=\"truncate text-[11px] font-medium text-foreground\">Cotton Shawl</div>",
            "                <div className=\"text-[11px] font-medium tabular-nums text-muted-foreground\">Rs. 1,400</div>",
            "              </div>",
            "              <div className=\"rounded-md border border-border bg-surface-1 p-2\">",
            "                <div className=\"mb-1.5 h-12 rounded-sm bg-secondary\" />",
            "                <div className=\"truncate text-[11px] font-medium text-foreground\">Khaddar Suit</div>",
            "                <div className=\"text-[11px] font-medium tabular-nums text-muted-foreground\">Rs. 2,800</div>",
            "              </div>",
            "            </div>",
            "            <div className=\"rounded-md bg-primary py-2 text-center text-xs font-medium text-primary-foreground\">",
            "              Complete Order (COD / JazzCash)",
            "            </div>",
            "          </div>",
            "        </div>",
            "      </Card>",
            "    </div>",
            "  );",
            "}",
            "",
            "function RowVisual({ kind }: { kind: PkValueVisualKind }) {",
            "  if (kind === \"cod-whatsapp\") return <CodWhatsappVisual />;",
            "  if (kind === \"payments-couriers\") return <PaymentsCouriersVisual />;",
            "  return <MobileStoreVisual />;",
            "}",
            "",
            "export function PkValueRows() {",
            "  return (",
            "    <Section id=\"features\" labelledBy=\"pk-features-heading\">",
            "      <SectionHeading",
            "        id=\"pk-features-heading\"",
            "        eyebrow=\"Built for Pakistan\"",
            "        title=\"Everything a Pakistani online store needs on day one\"",
            "        lead=\"No foreign plugins or complicated workarounds. Verify Cash on Delivery orders, collect local wallet payments, and ship across the country.\"",
            "        align=\"center\"",
            "      />",
            "",
            "      <div className=\"flex flex-col\">",
            "        {PK_VALUE_ROWS.map((row, index) => {",
            "          const isReversed = index % 2 === 1;",
            "          return (",
            "            <Reveal",
            "              key={row.id}",
            "              delay={100 + staggerDelay(index, 80)}",
            "              className=\"grid grid-cols-1 gap-8 border-t border-border py-12 md:py-16 lg:grid-cols-12 lg:gap-x-8\"",
            "            >",
            "              {/* Headline: 5 columns. Alternates between the left and the right side. */}",
            "              <div",
            "                className={cn(",
            "                  \"flex flex-col gap-4 lg:col-span-5 lg:row-start-1\",",
            "                  isReversed ? \"lg:col-start-8\" : \"lg:col-start-1\"",
            "                )}",
            "              >",
            "                <p className=\"text-xs font-medium uppercase tracking-widest text-muted-foreground\">{row.eyebrow}</p>",
            "                <h3 className=\"font-heading text-h2-sm font-semibold tracking-tight text-balance\">{row.title}</h3>",
            "              </div>",
            "",
            "              {/* Body, bullets and a text link: 6 columns. */}",
            "              <div",
            "                className={cn(",
            "                  \"flex min-w-0 flex-col gap-6 lg:col-span-6 lg:row-start-1\",",
            "                  isReversed ? \"lg:col-start-1\" : \"lg:col-start-7\"",
            "                )}",
            "              >",
            "                <p className=\"text-body leading-relaxed text-muted-foreground\">{row.description}</p>",
            "                <ul className=\"flex flex-col divide-y divide-border border-y border-border text-sm text-foreground\">",
            "                  {row.bullets.map((bullet) => (",
            "                    <li key={bullet} className=\"py-3\">",
            "                      {bullet}",
            "                    </li>",
            "                  ))}",
            "                </ul>",
            "                <Link",
            "                  href=\"/features\"",
            "                  className=\"w-fit rounded-sm text-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 outline-none transition-colors hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring\"",
            "                >",
            "                  Learn more",
            "                </Link>",
            "                <div aria-hidden=\"true\">",
            "                  <RowVisual kind={row.visual} />",
            "                </div>",
            "              </div>",
            "            </Reveal>",
            "          );",
            "        })}",
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
      "rel": "apps/storefront/components/marketing/process/how-it-works.tsx",
      "beforeSha": "5eca12a3832f9581f5320aabd7da73dc7020ceda072cb5a7803f7a971a8deeaa",
      "afterSha": "e9567c9a06827ba2446b0e6c5194a056614777898c0b2b9af0d35ce7212e0153",
      "edits": [
        {
          "name": "numbered steps",
          "expect": 1,
          "before": [
            "import { ArrowRight, PackagePlus, ShoppingBag, UserPlus } from \"lucide-react\";",
            "import { STEPS } from \"@/content/marketing/steps\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { Card } from \"@/components/shared/card\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { getSellerPortalUrl } from \"@/lib/urls\";",
            "",
            "const STEP_ICONS = [UserPlus, PackagePlus, ShoppingBag] as const;",
            "",
            "const FILL = \"h-full bg-primary motion-safe:transition-transform motion-safe:duration-1000 motion-safe:ease-out-expo\";",
            "",
            "export function HowItWorks() {",
            "  return (",
            "    <Section id=\"how-it-works\" labelledBy=\"process-heading\" tone=\"muted\">",
            "      <div className=\"flex flex-col items-center\">",
            "        <SectionHeading",
            "          id=\"process-heading\"",
            "          eyebrow=\"How It Works\"",
            "          title=\"From sign-up to your first order\"",
            "          lead=\"Focus on your products. We take care of the setup.\"",
            "          align=\"center\"",
            "        />",
            "",
            "        <Reveal className=\"group relative w-full\">",
            "          {/* Desktop rail: runs between the first and last badge centres and fills once revealed */}",
            "          <div",
            "            aria-hidden=\"true\"",
            "            className=\"absolute top-7 hidden h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-border md:block\"",
            "            style={{ left: \"calc((100% - 4rem) / 6)\", right: \"calc((100% - 4rem) / 6)\" }}",
            "          >",
            "            <div className={`${FILL} origin-left scale-x-100 motion-safe:scale-x-0 motion-safe:group-data-[revealed]:scale-x-100`} />",
            "          </div>",
            "",
            "          <ol className=\"relative grid gap-6 md:grid-cols-3 md:gap-8\">",
            "            {STEPS.map((step, i) => {",
            "              const Icon = STEP_ICONS[i];",
            "              const isLast = i === STEPS.length - 1;",
            "              return (",
            "                <li key={step.title} className=\"relative flex gap-5 md:flex-col md:gap-6\">",
            "                  {/* Mobile connector: from this badge down to the next one */}",
            "                  {!isLast && (",
            "                    <span",
            "                      aria-hidden=\"true\"",
            "                      className=\"absolute left-7 top-14 -bottom-6 w-0.5 -translate-x-1/2 overflow-hidden rounded-full bg-border md:hidden\"",
            "                    >",
            "                      <span className={`${FILL} origin-top scale-y-100 motion-safe:scale-y-0 motion-safe:group-data-[revealed]:scale-y-100`} />",
            "                    </span>",
            "                  )}",
            "",
            "                  <span className=\"relative z-10 flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground md:mx-auto md:size-16\">",
            "                    <Icon className=\"size-6\" aria-hidden=\"true\" />",
            "                  </span>",
            "",
            "                  <Card padding=\"md\" className=\"flex-1\">",
            "                    <p className=\"text-xs font-semibold uppercase tracking-widest text-muted-foreground\">",
            "                      Step {i + 1}",
            "                    </p>",
            "                    <h3 className=\"mt-2 text-xl font-semibold tracking-tight text-foreground\">{step.title}</h3>",
            "                    <p className=\"mt-2 text-sm leading-relaxed text-muted-foreground\">{step.description}</p>",
            "                  </Card>",
            "                </li>",
            "              );",
            "            })}",
            "          </ol>",
            "        </Reveal>",
            "",
            "        <Reveal delay={200} className=\"mt-12 flex justify-center\">",
            "          <Button asChild size=\"xl\">",
            "            <a href={getSellerPortalUrl(\"signup\")}>",
            "              Start free",
            "              <ArrowRight className=\"ml-2 size-4\" aria-hidden=\"true\" />",
            "            </a>",
            "          </Button>",
            "        </Reveal>",
            "      </div>",
            "    </Section>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import { ArrowRight } from \"lucide-react\";",
            "import { STEPS } from \"@/content/marketing/steps\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { getSellerPortalUrl } from \"@/lib/urls\";",
            "",
            "export function HowItWorks() {",
            "  return (",
            "    <Section id=\"how-it-works\" labelledBy=\"process-heading\">",
            "      <div className=\"flex flex-col items-center\">",
            "        <SectionHeading",
            "          id=\"process-heading\"",
            "          eyebrow=\"How It Works\"",
            "          title=\"From sign-up to your first order\"",
            "          lead=\"Focus on your products. We take care of the setup.\"",
            "          align=\"center\"",
            "        />",
            "",
            "        <Reveal className=\"w-full\">",
            "          <ol className=\"grid w-full divide-y divide-border border-y border-border md:grid-cols-3 md:divide-x md:divide-y-0\">",
            "            {STEPS.map((step, i) => (",
            "              <li key={step.title} className=\"py-8 md:px-8 md:first:pl-0 md:last:pr-0\">",
            "                <p className=\"font-mono text-sm text-muted-foreground\">{String(i + 1).padStart(2, \"0\")}</p>",
            "                <h3 className=\"mt-4 text-xl font-semibold tracking-tight text-foreground\">{step.title}</h3>",
            "                <p className=\"mt-2 text-sm leading-relaxed text-muted-foreground\">{step.description}</p>",
            "              </li>",
            "            ))}",
            "          </ol>",
            "        </Reveal>",
            "",
            "        <Reveal delay={200} className=\"mt-12 flex justify-center\">",
            "          <Button asChild size=\"xl\" className=\"rounded-full shadow-none\">",
            "            <a href={getSellerPortalUrl(\"signup\")}>",
            "              Start free",
            "              <ArrowRight className=\"ml-2 size-4\" aria-hidden=\"true\" />",
            "            </a>",
            "          </Button>",
            "        </Reveal>",
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
      "rel": "apps/storefront/components/marketing/themes/theme-card.tsx",
      "beforeSha": "89d87d88ffef352d1fae7ec689ffc6dd5e3b42e4e350906e4a703e8c079d7fe4",
      "afterSha": "bd2e0ad28daf9d446caa030a8e6dedcd4765fb26c4a008c86873e2e092203bd8",
      "edits": [
        {
          "name": "link style",
          "expect": 1,
          "before": [
            "inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:text-primary"
          ],
          "after": [
            "inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          ]
        },
        {
          "name": "image frame",
          "expect": 1,
          "before": [
            "className=\"relative rounded-xl border border-border bg-muted/60 p-6\""
          ],
          "after": [
            "className=\"relative rounded-md border border-border bg-surface-2 p-6\""
          ]
        },
        {
          "name": "tier chip",
          "expect": 1,
          "before": [
            "className=\"rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-foreground\""
          ],
          "after": [
            "className=\"rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground\""
          ]
        },
        {
          "name": "demo arrow",
          "expect": 1,
          "before": [
            "className=\"size-4 text-primary transition-transform"
          ],
          "after": [
            "className=\"size-4 text-muted-foreground transition-transform"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/themes/theme-device-stack.tsx",
      "beforeSha": "d79f3a35f4786b58b50954a3f3a8f0f5344055478e3f391f3e65bde3242cf443",
      "afterSha": "9342a2c508c175439d3875315ff47935037820439f6ff1e52bb92d7e194be5c9",
      "edits": [
        {
          "name": "neutral theme placeholder",
          "expect": 1,
          "before": [
            "import { Surface } from \"@/components/shared/surface\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "/**",
            " * ThemeDeviceStack: flat placeholder device mockup for a theme card.",
            " * A laptop frame with a phone frame overlapping its lower-right corner.",
            " * Used only when the theme has no real screenshot (see content/marketing/themes.ts).",
            " */",
            "",
            "type ThemeId = string;",
            "",
            "// Opaque tones (never alpha: the phone overlaps the laptop and must not show it through).",
            "const BEZEL = \"bg-[color-mix(in_oklab,var(--muted-foreground)_16%,var(--card))]\";",
            "",
            "/* ---------- Desktop screen layouts (one per theme) ---------- */",
            "",
            "function DesktopScreen({ id }: { id: ThemeId }) {",
            "  const nav = (",
            "    <div className=\"flex items-center justify-between border-b border-border/60 px-2.5 py-1.5\">",
            "      <div className=\"h-1.5 w-10 rounded-full bg-foreground/30\" />",
            "      <div className=\"flex gap-1.5\">",
            "        <div className=\"h-1 w-5 rounded-full bg-muted-foreground/30\" />",
            "        <div className=\"h-1 w-5 rounded-full bg-muted-foreground/30\" />",
            "        <div className=\"h-1 w-5 rounded-full bg-muted-foreground/30\" />",
            "      </div>",
            "    </div>",
            "  );",
            "",
            "  if (id === \"perfecto\") {",
            "    return (",
            "      <div className=\"flex h-full flex-col bg-background\">",
            "        {nav}",
            "        <div className=\"flex gap-1 px-2.5 pt-2\">",
            "          {[0, 1, 2, 3, 4].map((i) => (",
            "            <div key={i} className={cn(\"h-1.5 flex-1 rounded-full\", i === 0 ? \"bg-primary/60\" : \"bg-muted-foreground/15\")} />",
            "          ))}",
            "        </div>",
            "        <div className=\"grid flex-1 grid-cols-4 gap-1.5 p-2.5\">",
            "          {[0, 1, 2, 3].map((i) => (",
            "            <div key={i} className=\"flex flex-col gap-1\">",
            "              <div className=\"flex-1 rounded-sm bg-muted-foreground/15\" />",
            "              <div className=\"h-1 w-full rounded-full bg-foreground/15\" />",
            "              <div className=\"h-1 w-1/2 rounded-full bg-primary/50\" />",
            "            </div>",
            "          ))}",
            "        </div>",
            "      </div>",
            "    );",
            "  }",
            "",
            "  if (id === \"bazaar\") {",
            "    return (",
            "      <div className=\"flex h-full flex-col bg-background\">",
            "        {nav}",
            "        <div className=\"m-2.5 mb-1.5 flex h-[34%] items-center rounded-md bg-primary/15 p-2.5\">",
            "          <div className=\"flex w-1/2 flex-col gap-1\">",
            "            <div className=\"h-1.5 w-full rounded-full bg-primary/60\" />",
            "            <div className=\"h-1 w-2/3 rounded-full bg-foreground/20\" />",
            "          </div>",
            "        </div>",
            "        <div className=\"grid flex-1 grid-cols-3 gap-1.5 px-2.5 pb-2.5\">",
            "          {[0, 1, 2, 3, 4, 5].map((i) => (",
            "            <div key={i} className=\"rounded-sm bg-muted-foreground/15\" />",
            "          ))}",
            "        </div>",
            "      </div>",
            "    );",
            "  }",
            "",
            "  // aura",
            "  return (",
            "    <div className=\"flex h-full flex-col bg-background\">",
            "        {nav}",
            "      <div className=\"flex flex-1 items-end justify-center gap-3 px-3 pt-3\">",
            "        <div className=\"flex w-1/4 flex-col gap-1 self-center\">",
            "          <div className=\"h-1.5 w-full rounded-full bg-foreground/25\" />",
            "          <div className=\"h-1 w-2/3 rounded-full bg-muted-foreground/30\" />",
            "          <div className=\"mt-1 h-3 w-1/2 rounded-full bg-primary/50\" />",
            "        </div>",
            "        <div className=\"h-[88%] w-2/5 rounded-t-full bg-muted-foreground/15\" />",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            "",
            "/* ---------- Mobile screen layouts ---------- */",
            "",
            "function MobileScreen({ id }: { id: ThemeId }) {",
            "  const bar = (",
            "    <div className=\"flex items-center justify-between px-2 pb-1.5 pt-4\">",
            "      <div className=\"h-1 w-5 rounded-full bg-foreground/30\" />",
            "      <div className=\"h-1.5 w-1.5 rounded-full bg-primary/60\" />",
            "    </div>",
            "  );",
            "",
            "  if (id === \"perfecto\") {",
            "    return (",
            "      <div className=\"flex h-full flex-col bg-background\">",
            "        {bar}",
            "        <div className=\"grid flex-1 grid-cols-2 gap-1 p-1.5 pt-0.5\">",
            "          {[0, 1, 2, 3].map((i) => (",
            "            <div key={i} className=\"flex flex-col gap-0.5\">",
            "              <div className=\"flex-1 rounded-sm bg-muted-foreground/15\" />",
            "              <div className=\"h-0.5 w-full rounded-full bg-foreground/15\" />",
            "              <div className=\"h-0.5 w-1/2 rounded-full bg-primary/50\" />",
            "            </div>",
            "          ))}",
            "        </div>",
            "      </div>",
            "    );",
            "  }",
            "",
            "  if (id === \"bazaar\") {",
            "    return (",
            "      <div className=\"flex h-full flex-col bg-background\">",
            "        {bar}",
            "        <div className=\"mx-1.5 h-[26%] rounded-sm bg-primary/15\" />",
            "        <div className=\"grid flex-1 grid-cols-2 gap-1 p-1.5\">",
            "          {[0, 1, 2, 3].map((i) => (",
            "            <div key={i} className=\"rounded-sm bg-muted-foreground/15\" />",
            "          ))}",
            "        </div>",
            "      </div>",
            "    );",
            "  }",
            "",
            "  return (",
            "    <div className=\"flex h-full flex-col bg-background\">",
            "      {bar}",
            "      <div className=\"flex flex-1 flex-col items-center gap-1.5 px-2 pt-2\">",
            "        <div className=\"h-1 w-8 rounded-full bg-foreground/25\" />",
            "        <div className=\"w-full flex-1 rounded-t-full bg-muted-foreground/15\" />",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            "",
            "/* ---------- Devices ---------- */",
            "",
            "function Laptop({ id }: { id: ThemeId }) {",
            "  return (",
            "    <div className=\"relative mx-auto w-[88%]\">",
            "      {/* Lid */}",
            "      <Surface",
            "        level={1}",
            "        radius=\"xl\"",
            "        className={cn(BEZEL, \"p-1.5 transition-colors duration-(--dur-base) group-hover/theme:border-primary/30\")}",
            "      >",
            "        <div className=\"relative aspect-[16/10] overflow-hidden rounded-md border border-border bg-background\">",
            "          <DesktopScreen id={id} />",
            "        </div>",
            "      </Surface>",
            "      {/* Hinge / base: wider than the lid, so the laptop sits on the floor */}",
            "      <div",
            "        className=\"relative -mx-[6%] h-2.5 rounded-b-2xl border border-t-0 border-border bg-[color-mix(in_oklab,var(--muted-foreground)_24%,var(--card))]\"",
            "        aria-hidden=\"true\"",
            "      >",
            "        <div className=\"mx-auto h-1 w-1/5 rounded-b-md bg-muted-foreground/30\" />",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            "",
            "function Phone({ id }: { id: ThemeId }) {",
            "  return (",
            "    <div className=\"w-full\">",
            "      <Surface",
            "        level={2}",
            "        radius=\"3xl\"",
            "        className={cn(BEZEL, \"relative aspect-[9/19] w-full p-1 transition-colors duration-(--dur-base) group-hover/theme:border-primary/30\")}",
            "      >",
            "        <div className=\"absolute left-1/2 top-1.5 z-10 h-1 w-1/4 -translate-x-1/2 rounded-full bg-border\" />",
            "        <div className=\"h-full overflow-hidden rounded-[1.4rem] border border-border bg-background\">",
            "          <MobileScreen id={id} />",
            "        </div>",
            "      </Surface>",
            "    </div>",
            "  );",
            "}",
            "",
            "export function ThemeDeviceStack({ id, className }: { id: ThemeId; className?: string }) {",
            "  return (",
            "    <div className={cn(\"relative mx-auto w-full max-w-sm\", className)}>",
            "      <Laptop id={id} />",
            "",
            "      {/* Phone overlaps the laptop's lower-right corner */}",
            "      <div className=\"absolute -bottom-3 right-[2%] z-10 w-[24%]\">",
            "        <Phone id={id} />",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import { cn } from \"@/lib/utils\";",
            "",
            "/**",
            " * Neutral placeholder for a theme card or detail page when the theme has no real screenshot",
            " * (see content/marketing/themes.ts). A hairline wireframe, not a picture of the theme.",
            " */",
            "export function ThemeDeviceStack({ id, className }: { id: string; className?: string }) {",
            "  return (",
            "    <div data-theme-placeholder={id} className={cn(\"relative mx-auto w-full max-w-sm\", className)}>",
            "      <div className=\"aspect-[16/10] overflow-hidden rounded-md border border-border bg-background\">",
            "        <div className=\"flex items-center justify-between border-b border-border px-3 py-2\">",
            "          <div className=\"h-1.5 w-10 rounded-full bg-border-strong\" />",
            "          <div className=\"flex gap-1.5\">",
            "            <div className=\"h-1 w-5 rounded-full bg-border\" />",
            "            <div className=\"h-1 w-5 rounded-full bg-border\" />",
            "            <div className=\"h-1 w-5 rounded-full bg-border\" />",
            "          </div>",
            "        </div>",
            "        <div className=\"grid grid-cols-3 gap-2 p-3\">",
            "          <div className=\"col-span-3 h-10 rounded-sm bg-surface-2\" />",
            "          <div className=\"h-12 rounded-sm bg-surface-2\" />",
            "          <div className=\"h-12 rounded-sm bg-surface-2\" />",
            "          <div className=\"h-12 rounded-sm bg-surface-2\" />",
            "        </div>",
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
      "rel": "apps/storefront/components/marketing/pricing/pricing-section.tsx",
      "beforeSha": "a7a0c97a20cb9dd71dcc99c6d87f7aa2a73933d2550a6f3792aaacefc1da479d",
      "afterSha": "2e5d50d257e335709482e49d77b1d7e53fc11a2e33133067d586864a302cbd88",
      "edits": [
        {
          "name": "pricing as one hairline table",
          "expect": 1,
          "before": [
            "import { Check } from \"lucide-react\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { Card } from \"@/components/shared/card\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { staggerDelay } from \"@/components/shared/motion\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { PLANS } from \"@/content/marketing/pricing\";",
            "import { formatPKR } from \"@/lib/format\";",
            "import { getSellerPortalUrl } from \"@/lib/urls\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "/**",
            " * Plan cards. Used on the home page (with its heading) and on /pricing (heading supplied by the",
            " * page header, so the section keeps a visually hidden heading for its landmark). Prices come from",
            " * content/marketing/pricing.ts in PKR. Every plan CTA goes to seller signup.",
            " */",
            "export function PricingSection({ withHeading = true }: { withHeading?: boolean }) {",
            "  const signupUrl = getSellerPortalUrl(\"signup\");",
            "",
            "  return (",
            "    <Section id=\"pricing\" labelledBy={withHeading ? \"pricing-heading\" : \"pricing-plans-heading\"}>",
            "      <div className=\"flex flex-col items-center\">",
            "        {withHeading ? (",
            "          <SectionHeading",
            "            id=\"pricing-heading\"",
            "            eyebrow=\"Pricing\"",
            "            title=\"Simple pricing\"",
            "            lead=\"Start free and upgrade when your store grows. Prices are in Pakistani rupees (PKR).\"",
            "            align=\"center\"",
            "          />",
            "        ) : (",
            "          <h2 id=\"pricing-plans-heading\" className=\"sr-only\">",
            "            Plans and prices",
            "          </h2>",
            "        )}",
            "",
            "        <div className=\"grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-2 md:gap-8\">",
            "          {PLANS.map((plan, i) => (",
            "            <Reveal key={plan.id} delay={100 + staggerDelay(i)} className=\"flex\">",
            "              <Card",
            "                padding=\"responsive\"",
            "                className={cn(",
            "                  \"relative flex w-full flex-col justify-between\",",
            "                  plan.highlight && \"border-primary ring-1 ring-primary\",",
            "                )}",
            "              >",
            "                {plan.highlight && (",
            "                  <span className=\"absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground\">",
            "                    For growing stores",
            "                  </span>",
            "                )}",
            "",
            "                <div>",
            "                  <h3 className=\"text-xl font-semibold tracking-tight text-foreground\">{plan.name}</h3>",
            "                  <p className=\"mt-2 text-sm leading-relaxed text-muted-foreground\">{plan.description}</p>",
            "",
            "                  <p className=\"mt-6 flex items-baseline gap-2\">",
            "                    <span className=\"text-4xl font-semibold tracking-tight text-foreground\">",
            "                      {plan.monthlyPrice === 0 ? \"Free\" : formatPKR(plan.monthlyPrice)}",
            "                    </span>",
            "                    {plan.monthlyPrice > 0 && <span className=\"text-sm text-muted-foreground\">/ month</span>}",
            "                  </p>",
            "",
            "                  <ul className=\"mt-6 space-y-3 border-t border-border pt-6\">",
            "                    {plan.features.map((feature) => (",
            "                      <li key={feature} className=\"flex items-start gap-3 text-sm text-foreground\">",
            "                        <Check className=\"mt-0.5 size-4 shrink-0 text-primary\" aria-hidden=\"true\" />",
            "                        <span>{feature}</span>",
            "                      </li>",
            "                    ))}",
            "                  </ul>",
            "                </div>",
            "",
            "                <div className=\"mt-8\">",
            "                  <Button asChild variant={plan.highlight ? \"default\" : \"outline\"} size=\"xl\" className=\"w-full\">",
            "                    <a href={signupUrl}>{plan.cta}</a>",
            "                  </Button>",
            "                </div>",
            "              </Card>",
            "            </Reveal>",
            "          ))}",
            "        </div>",
            "      </div>",
            "    </Section>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import { Check } from \"lucide-react\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { PLANS } from \"@/content/marketing/pricing\";",
            "import { formatPKR } from \"@/lib/format\";",
            "import { getSellerPortalUrl } from \"@/lib/urls\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "/**",
            " * Plans as one hairline table. Used on the home page (with its heading) and on /pricing (heading",
            " * supplied by the page header, so the section keeps a visually hidden heading for its landmark).",
            " * Prices come from content/marketing/pricing.ts in PKR. Every plan CTA goes to seller signup.",
            " */",
            "export function PricingSection({ withHeading = true }: { withHeading?: boolean }) {",
            "  const signupUrl = getSellerPortalUrl(\"signup\");",
            "",
            "  return (",
            "    <Section id=\"pricing\" labelledBy={withHeading ? \"pricing-heading\" : \"pricing-plans-heading\"}>",
            "      <div className=\"flex flex-col items-center\">",
            "        {withHeading ? (",
            "          <SectionHeading",
            "            id=\"pricing-heading\"",
            "            eyebrow=\"Pricing\"",
            "            title=\"Simple pricing\"",
            "            lead=\"Start free and upgrade when your store grows. Prices are in Pakistani rupees (PKR).\"",
            "            align=\"center\"",
            "          />",
            "        ) : (",
            "          <h2 id=\"pricing-plans-heading\" className=\"sr-only\">",
            "            Plans and prices",
            "          </h2>",
            "        )}",
            "",
            "        <Reveal delay={100} className=\"w-full max-w-4xl\">",
            "          <div className=\"grid grid-cols-1 divide-y divide-border overflow-hidden rounded-lg border border-border md:grid-cols-2 md:divide-x md:divide-y-0\">",
            "            {PLANS.map((plan) => (",
            "              <div",
            "                key={plan.id}",
            "                className={cn(\"flex flex-col justify-between p-6 md:p-8\", plan.highlight && \"bg-surface-1\")}",
            "              >",
            "                <div>",
            "                  <div className=\"flex items-center justify-between gap-3\">",
            "                    <h3 className=\"text-xl font-semibold tracking-tight text-foreground\">{plan.name}</h3>",
            "                    {plan.highlight && (",
            "                      <span className=\"rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-foreground\">",
            "                        For growing stores",
            "                      </span>",
            "                    )}",
            "                  </div>",
            "                  <p className=\"mt-2 text-sm leading-relaxed text-muted-foreground\">{plan.description}</p>",
            "",
            "                  <p className=\"mt-6 flex items-baseline gap-2\">",
            "                    <span className=\"text-4xl font-semibold tracking-tight text-foreground\">",
            "                      {plan.monthlyPrice === 0 ? \"Free\" : formatPKR(plan.monthlyPrice)}",
            "                    </span>",
            "                    {plan.monthlyPrice > 0 && <span className=\"text-sm text-muted-foreground\">/ month</span>}",
            "                  </p>",
            "",
            "                  <ul className=\"mt-6 divide-y divide-border border-y border-border\">",
            "                    {plan.features.map((feature) => (",
            "                      <li key={feature} className=\"flex items-start gap-3 py-3 text-sm text-foreground\">",
            "                        <Check className=\"mt-0.5 size-4 shrink-0 text-muted-foreground\" aria-hidden=\"true\" />",
            "                        <span>{feature}</span>",
            "                      </li>",
            "                    ))}",
            "                  </ul>",
            "                </div>",
            "",
            "                <div className=\"mt-8\">",
            "                  <Button",
            "                    asChild",
            "                    variant={plan.highlight ? \"default\" : \"outline\"}",
            "                    size=\"xl\"",
            "                    className=\"w-full rounded-full shadow-none\"",
            "                  >",
            "                    <a href={signupUrl}>{plan.cta}</a>",
            "                  </Button>",
            "                </div>",
            "              </div>",
            "            ))}",
            "          </div>",
            "        </Reveal>",
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
      "rel": "apps/storefront/components/marketing/pricing/plan-comparison.tsx",
      "beforeSha": "86bfb6fd014861f885be6bd426544de2d9c334f31b39b6f42158eb9139840f22",
      "afterSha": "05f5a7969457c49799bf9d47d98ea0287629181e06aab2bfbd02d19c2e47dbf9",
      "edits": [
        {
          "name": "table frame",
          "expect": 1,
          "before": [
            "className=\"w-full overflow-x-auto rounded-2xl border border-border bg-card\""
          ],
          "after": [
            "className=\"w-full overflow-x-auto rounded-lg border border-border\""
          ]
        },
        {
          "name": "table head",
          "expect": 1,
          "before": [
            "<tr className=\"border-b border-border\">"
          ],
          "after": [
            "<tr className=\"border-b border-border bg-surface-1\">"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/pricing/billing-toggle.tsx",
      "beforeSha": "bbddbc3b0ac9369ada2a68d6c7af97af96930ac145fd9280fc66c912e96a3f5a",
      "afterSha": "69e677e4c78665c0109038a931d92837309447bada6dfdd43d3de75d44e867b1",
      "edits": [
        {
          "name": "toggle without shadows",
          "expect": 2,
          "before": [
            "className=\"rounded-full px-6 py-2 h-9 data-[pressed]:bg-card data-[pressed]:shadow-sm data-[state=on]:bg-card data-[state=on]:shadow-sm transition-all\""
          ],
          "after": [
            "className=\"rounded-full px-6 py-2 h-9 transition-colors data-[pressed]:bg-card data-[state=on]:bg-card\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/support/support-section.tsx",
      "beforeSha": "ede964335637645df152de56c4647366823a008e4fe2a28ed1344cf6b6769ec2",
      "afterSha": "13b2e4b2e05363ce7d2411a3861ca4224c2c564a952850a4fca061f61da82ee8",
      "edits": [
        {
          "name": "support without icon circles",
          "expect": 1,
          "before": [
            "import type { ReactNode } from \"react\";",
            "import { Headset } from \"lucide-react\";",
            "import { SUPPORT_CHANNELS, SUPPORT_HIGHLIGHTS } from \"@/content/marketing/support\";",
            "import { Card } from \"@/components/shared/card\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { staggerDelay } from \"@/components/shared/motion\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { BRAND } from \"@/lib/brand\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "/** One chat message. Agent messages sit on the right in the brand colour. */",
            "function Bubble({ from, children }: { from: \"customer\" | \"agent\"; children: ReactNode }) {",
            "  const agent = from === \"agent\";",
            "  return (",
            "    <div",
            "      className={cn(",
            "        \"max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed\",",
            "        agent",
            "          ? \"self-end rounded-br-md bg-primary text-primary-foreground\"",
            "          : \"self-start rounded-bl-md border border-border bg-card text-foreground\",",
            "      )}",
            "    >",
            "      {children}",
            "    </div>",
            "  );",
            "}",
            "",
            "/** Flat decorative chat card. It is an example of a support reply, not a live widget. */",
            "function SupportChat() {",
            "  return (",
            "    <Card padding=\"md\" className=\"mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0\">",
            "      <div className=\"flex items-center gap-3\">",
            "        <span className=\"flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground\">",
            "          <Headset className=\"size-5\" aria-hidden=\"true\" />",
            "        </span>",
            "        <div className=\"flex flex-1 flex-col\">",
            "          <span className=\"font-semibold text-foreground\">{BRAND.name} Support</span>",
            "          <span className=\"text-xs text-muted-foreground\">Support team</span>",
            "        </div>",
            "        <span className=\"inline-flex items-center rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground\">",
            "          Example",
            "        </span>",
            "      </div>",
            "",
            "      <div className=\"flex flex-col gap-3 rounded-xl border border-border bg-muted/50 p-4\">",
            "        <Bubble from=\"customer\">Salam! My JazzCash payment went through, but the order still says pending.</Bubble>",
            "        <Bubble from=\"agent\">Wa alaikum assalam. I can see the payment. Confirming your order now.</Bubble>",
            "        <Bubble from=\"customer\">Shukriya, that was quick!</Bubble>",
            "      </div>",
            "",
            "      <ul className=\"flex flex-wrap gap-2\" aria-label=\"Ways to reach us\">",
            "        {SUPPORT_CHANNELS.map((channel) => (",
            "          <li",
            "            key={channel.id}",
            "            className=\"inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground\"",
            "          >",
            "            <channel.icon className=\"size-4 text-primary\" aria-hidden=\"true\" />",
            "            {channel.label}",
            "          </li>",
            "        ))}",
            "      </ul>",
            "    </Card>",
            "  );",
            "}",
            "",
            "export function SupportSection() {",
            "  return (",
            "    <Section id=\"support\" labelledBy=\"support-heading\">",
            "      <div className=\"grid items-center gap-12 lg:grid-cols-2 lg:gap-20\">",
            "        <div className=\"flex flex-col\">",
            "          <SectionHeading",
            "            id=\"support-heading\"",
            "            eyebrow=\"Customer Service\"",
            "            title=\"Real people, on your side\"",
            "            lead=\"Selling online should not mean working things out alone. Reach a person who understands your market, whenever you need one.\"",
            "            align=\"start\"",
            "            size=\"md\"",
            "            className=\"mb-8 md:mb-10\"",
            "          />",
            "",
            "          <div className=\"flex flex-col gap-4\">",
            "            {SUPPORT_HIGHLIGHTS.map((item, i) => (",
            "              <Reveal key={item.id} delay={100 + staggerDelay(i)}>",
            "                <Card padding=\"md\" className=\"flex items-start gap-5\">",
            "                  <span className=\"flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground\">",
            "                    <item.icon className=\"size-5\" aria-hidden=\"true\" />",
            "                  </span>",
            "                  <div className=\"flex flex-col gap-1.5\">",
            "                    <h3 className=\"text-xl font-semibold tracking-tight text-foreground\">{item.title}</h3>",
            "                    <p className=\"text-sm leading-relaxed text-muted-foreground\">{item.description}</p>",
            "                  </div>",
            "                </Card>",
            "              </Reveal>",
            "            ))}",
            "          </div>",
            "",
            "          <Reveal delay={300} className=\"mt-8\">",
            "            <Button asChild size=\"xl\">",
            "              <a href=\"/contact\">Talk to our team</a>",
            "            </Button>",
            "          </Reveal>",
            "        </div>",
            "",
            "        <Reveal delay={150} aria-hidden=\"true\">",
            "          <SupportChat />",
            "        </Reveal>",
            "      </div>",
            "    </Section>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "import type { ReactNode } from \"react\";",
            "import { Headset } from \"lucide-react\";",
            "import { SUPPORT_CHANNELS, SUPPORT_HIGHLIGHTS } from \"@/content/marketing/support\";",
            "import { Card } from \"@/components/shared/card\";",
            "import { Reveal } from \"@/components/shared/reveal\";",
            "import { staggerDelay } from \"@/components/shared/motion\";",
            "import { Section } from \"@/components/shared/section\";",
            "import { SectionHeading } from \"@/components/shared/section-heading\";",
            "import { Button } from \"@/components/ui/button\";",
            "import { BRAND } from \"@/lib/brand\";",
            "import { cn } from \"@/lib/utils\";",
            "",
            "/** One chat message. Agent messages sit on the right in the inverse primary pair. */",
            "function Bubble({ from, children }: { from: \"customer\" | \"agent\"; children: ReactNode }) {",
            "  const agent = from === \"agent\";",
            "  return (",
            "    <div",
            "      className={cn(",
            "        \"max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed\",",
            "        agent",
            "          ? \"self-end bg-primary text-primary-foreground\"",
            "          : \"self-start border border-border bg-surface-2 text-foreground\",",
            "      )}",
            "    >",
            "      {children}",
            "    </div>",
            "  );",
            "}",
            "",
            "/** Flat decorative chat card. It is an example of a support reply, not a live widget. */",
            "function SupportChat() {",
            "  return (",
            "    <Card padding=\"md\" className=\"mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0\">",
            "      <div className=\"flex items-center gap-3\">",
            "        <span className=\"flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-foreground\">",
            "          <Headset className=\"size-5\" aria-hidden=\"true\" />",
            "        </span>",
            "        <div className=\"flex flex-1 flex-col\">",
            "          <span className=\"font-medium text-foreground\">{BRAND.name} Support</span>",
            "          <span className=\"text-xs text-muted-foreground\">Support team</span>",
            "        </div>",
            "        <span className=\"inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground\">",
            "          Example",
            "        </span>",
            "      </div>",
            "",
            "      <div className=\"flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-4\">",
            "        <Bubble from=\"customer\">Salam! My JazzCash payment went through, but the order still says pending.</Bubble>",
            "        <Bubble from=\"agent\">Wa alaikum assalam. I can see the payment. Confirming your order now.</Bubble>",
            "        <Bubble from=\"customer\">Shukriya, that was quick!</Bubble>",
            "      </div>",
            "",
            "      <ul className=\"flex flex-wrap gap-2\" aria-label=\"Ways to reach us\">",
            "        {SUPPORT_CHANNELS.map((channel) => (",
            "          <li",
            "            key={channel.id}",
            "            className=\"inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground\"",
            "          >",
            "            <channel.icon className=\"size-4 text-muted-foreground\" aria-hidden=\"true\" />",
            "            {channel.label}",
            "          </li>",
            "        ))}",
            "      </ul>",
            "    </Card>",
            "  );",
            "}",
            "",
            "export function SupportSection() {",
            "  return (",
            "    <Section id=\"support\" labelledBy=\"support-heading\">",
            "      <div className=\"grid items-center gap-12 lg:grid-cols-2 lg:gap-20\">",
            "        <div className=\"flex flex-col\">",
            "          <SectionHeading",
            "            id=\"support-heading\"",
            "            eyebrow=\"Customer Service\"",
            "            title=\"Real people, on your side\"",
            "            lead=\"Selling online should not mean working things out alone. Reach a person who understands your market, whenever you need one.\"",
            "            align=\"start\"",
            "            size=\"md\"",
            "            className=\"mb-8 md:mb-10\"",
            "          />",
            "",
            "          <ul className=\"flex flex-col divide-y divide-border border-y border-border\">",
            "            {SUPPORT_HIGHLIGHTS.map((item, i) => (",
            "              <li key={item.id}>",
            "                <Reveal delay={100 + staggerDelay(i)} className=\"flex items-start gap-4 py-6\">",
            "                  <item.icon className=\"mt-1 size-5 shrink-0 text-muted-foreground\" aria-hidden=\"true\" />",
            "                  <div className=\"flex flex-col gap-1.5\">",
            "                    <h3 className=\"text-xl font-semibold tracking-tight text-foreground\">{item.title}</h3>",
            "                    <p className=\"text-sm leading-relaxed text-muted-foreground\">{item.description}</p>",
            "                  </div>",
            "                </Reveal>",
            "              </li>",
            "            ))}",
            "          </ul>",
            "",
            "          <Reveal delay={300} className=\"mt-8\">",
            "            <Button asChild size=\"xl\" className=\"rounded-full shadow-none\">",
            "              <a href=\"/contact\">Talk to our team</a>",
            "            </Button>",
            "          </Reveal>",
            "        </div>",
            "",
            "        <Reveal delay={150} aria-hidden=\"true\">",
            "          <SupportChat />",
            "        </Reveal>",
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
      "rel": "apps/storefront/components/marketing/faq/faq-section.tsx",
      "beforeSha": "b3c801d38c8ca53058bfe70da009271e6032529ece95cbc85a93560216d813bd",
      "afterSha": "64685ce282157c1d72529a9b1888bd0906f0f908f3ea5ee35ed3b11e266addb4",
      "edits": [
        {
          "name": "faq section tone",
          "expect": 1,
          "before": [
            "<Section id=\"faq\" labelledBy=\"faq-heading\" tone=\"muted\">"
          ],
          "after": [
            "<Section id=\"faq\" labelledBy=\"faq-heading\">"
          ]
        },
        {
          "name": "faq contact link",
          "expect": 1,
          "before": [
            "className=\"inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm w-fit -mt-4\""
          ],
          "after": [
            "className=\"-mt-4 inline-flex w-fit items-center gap-2 rounded-sm text-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring\""
          ]
        },
        {
          "name": "faq contact icon",
          "expect": 1,
          "before": [
            "<MessageCircle className=\"size-4 text-primary\" aria-hidden=\"true\" />"
          ],
          "after": [
            "<MessageCircle className=\"size-4 text-muted-foreground\" aria-hidden=\"true\" />"
          ]
        },
        {
          "name": "faq trigger",
          "expect": 1,
          "before": [
            "className=\"text-left text-lg font-semibold hover:text-primary transition-colors min-h-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm\""
          ],
          "after": [
            "className=\"min-h-14 rounded-sm text-left text-base font-medium transition-colors hover:text-muted-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/cta/closing-cta.tsx",
      "beforeSha": "4b56c209531ecd70676b53f7227c0e37c9f483962749c823b776d40f75665e20",
      "afterSha": "e77e1eb680ef352d8724a7890e53ff2aa179942e5fe2c9050e21a7d1ee77d586",
      "edits": [
        {
          "name": "cta heading",
          "expect": 1,
          "before": [
            "className=\"text-h2 text-balance\""
          ],
          "after": [
            "className=\"font-heading text-h2 font-semibold tracking-tight text-balance\""
          ]
        },
        {
          "name": "cta pill",
          "expect": 1,
          "before": [
            "<Button asChild size=\"xl\" className=\"mt-8\">"
          ],
          "after": [
            "<Button asChild size=\"xl\" className=\"mt-8 rounded-full shadow-none\">"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/contact/contact-form.tsx",
      "beforeSha": "53b1951353a737504a092ae31a688e3517ab79d424676303f19913a9c1032839",
      "afterSha": "4602d616f6c5a4e4a6f80d05947f30ab1ae520e1cf8e67ea758a5f9b51533052",
      "edits": [
        {
          "name": "field focus ring",
          "expect": 2,
          "before": [
            "focus-visible:ring-3 focus-visible:ring-ring/50"
          ],
          "after": [
            "focus-visible:ring-2 focus-visible:ring-ring"
          ]
        },
        {
          "name": "form frame",
          "expect": 1,
          "before": [
            "className=\"flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 md:p-8\""
          ],
          "after": [
            "className=\"flex flex-col gap-6 rounded-lg border border-border bg-surface-1 p-6 md:p-8\""
          ]
        },
        {
          "name": "send pill",
          "expect": 1,
          "before": [
            "<Button type=\"submit\" size=\"xl\" className=\"w-full\" disabled={submitting}>"
          ],
          "after": [
            "<Button type=\"submit\" size=\"xl\" className=\"w-full rounded-full shadow-none\" disabled={submitting}>"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/shared/view-all-link.tsx",
      "beforeSha": "bc70b6f840bb62cefe89e937d14d063a45ca5614f1656b65a3d81cdb1f569483",
      "afterSha": "b7eeb0721f196ea219a267cf0cb78c2b6fb58c3ea7aa0b05687889244f794770",
      "edits": [
        {
          "name": "view all link",
          "expect": 1,
          "before": [
            "\"inline-flex min-h-11 items-center rounded-sm px-1 text-base font-medium text-foreground underline decoration-primary decoration-2 underline-offset-8\","
          ],
          "after": [
            "\"inline-flex min-h-11 items-center rounded-sm px-1 text-base font-medium text-foreground underline decoration-border-strong underline-offset-4\","
          ]
        },
        {
          "name": "view all focus",
          "expect": 1,
          "before": [
            "\"outline-none focus-visible:ring-3 focus-visible:ring-ring/50\","
          ],
          "after": [
            "\"outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring\","
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/shared/surface.tsx",
      "beforeSha": "08501761fdb05c42ce2b22f11f77cb96989e32b66477d01181ea9b65cbbcd716",
      "afterSha": "ca987812380b82613524d2b3eda2ddf57a9c31526e97b1fb00870465819fb127",
      "edits": [
        {
          "name": "flat levels",
          "expect": 1,
          "before": [
            "  0: \"border-border shadow-none\",",
            "  1: \"border-border shadow-sm\",",
            "  2: \"border-border shadow-md\",",
            "  3: \"border-border shadow-lg\",",
            "  4: \"border-border shadow-xl\","
          ],
          "after": [
            "  0: \"border-border shadow-none\",",
            "  1: \"border-border shadow-none\",",
            "  2: \"border-border shadow-none\",",
            "  // Levels 3 and 4 are floating layers (popover, dialog): the only place shadows remain.",
            "  3: \"border-border shadow-lg\",",
            "  4: \"border-border shadow-xl\","
          ]
        },
        {
          "name": "interactive variant",
          "expect": 1,
          "before": [
            "\"bg-card text-card-foreground border transition-[box-shadow,border-color,background-color] duration-(--dur-base) hover:border-border-strong hover:shadow-md\","
          ],
          "after": [
            "\"bg-card text-card-foreground border transition-[border-color,background-color] duration-(--dur-base) hover:border-border-strong\","
          ]
        },
        {
          "name": "lift",
          "expect": 1,
          "before": [
            "\"transition-[box-shadow,border-color,background-color] duration-(--dur-base) hover:shadow-md hover:border-border-strong\";"
          ],
          "after": [
            "\"transition-[border-color,background-color] duration-(--dur-base) hover:border-border-strong\";"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/shared/card.tsx",
      "beforeSha": "4711f731ca6c5d4a41f3a957226d804233f5f52752b23db4e514776fc59ca0cd",
      "afterSha": "43c187d9b7215f4138706cca1802aebc1729918a49b3d39f528016a4c6df7330",
      "edits": [
        {
          "name": "flat interactive card",
          "expect": 1,
          "before": [
            "\"transition-[transform,box-shadow,border-color] duration-(--dur-base) ease-out-expo hover:border-border-strong hover:shadow-md motion-safe:hover:-translate-y-0.5\";"
          ],
          "after": [
            "\"transition-[border-color,background-color] duration-(--dur-base) ease-out-expo hover:border-border-strong\";"
          ]
        },
        {
          "name": "card radius",
          "expect": 1,
          "before": [
            "radius=\"2xl\""
          ],
          "after": [
            "radius=\"lg\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/shared/brand-mark.tsx",
      "beforeSha": "272f9341c335363b769ef53c097a72ba558f54f5495780e0358ad798970cc18e",
      "afterSha": "50fc9a89daa7f7ede5128d781b9559adbb63bc8ae9771cf984e0ca8c5027e26b",
      "edits": [
        {
          "name": "logo without shadow",
          "expect": 1,
          "before": [
            "font-heading text-lg font-semibold text-primary-foreground shadow-sm"
          ],
          "after": [
            "font-heading text-lg font-semibold text-primary-foreground"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/ui/button.tsx",
      "beforeSha": "ef2d689878bb773d576ef98682fff3db6c90cf617a05da951714036df9d11c00",
      "afterSha": "c37caedee53f89112bc637b6e9d3f68d2b5c8370dd2efa81ad63c6af1234a7a5",
      "edits": [
        {
          "name": "default variant",
          "expect": 1,
          "before": [
            "\"bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/95\""
          ],
          "after": [
            "\"bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95\""
          ]
        },
        {
          "name": "destructive variant",
          "expect": 1,
          "before": [
            "\"bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/30\""
          ],
          "after": [
            "\"bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30\""
          ]
        },
        {
          "name": "outline variant",
          "expect": 1,
          "before": [
            "text-foreground shadow-2xs hover:bg-accent"
          ],
          "after": [
            "text-foreground hover:bg-accent"
          ]
        },
        {
          "name": "secondary variant",
          "expect": 1,
          "before": [
            "\"bg-secondary text-secondary-foreground shadow-2xs hover:bg-secondary/80\""
          ],
          "after": [
            "\"bg-secondary text-secondary-foreground hover:bg-secondary/80\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/app/(marketing)/features/page.tsx",
      "beforeSha": "2936d0c3ac231c41f2c9954b9e4bcb740ee16b4c4453bdddd54054d1acdc1144",
      "afterSha": "cbd5e8e33c886f9e745bc4021a2092788145911acd138d866038bdc19414b131",
      "edits": [
        {
          "name": "feature icon without circle",
          "expect": 1,
          "before": [
            "                    <span className=\"flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground\">",
            "                      <Icon className=\"size-5\" aria-hidden=\"true\" />",
            "                    </span>",
            ""
          ],
          "after": [
            "                    <Icon className=\"size-5 text-muted-foreground\" aria-hidden=\"true\" />",
            ""
          ]
        },
        {
          "name": "feature check",
          "expect": 1,
          "before": [
            "<Check className=\"mt-0.5 size-4 shrink-0 text-primary\" aria-hidden=\"true\" />"
          ],
          "after": [
            "<Check className=\"mt-0.5 size-4 shrink-0 text-muted-foreground\" aria-hidden=\"true\" />"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/app/(marketing)/themes/[slug]/page.tsx",
      "beforeSha": "8eaa015475f59ba0aee3b89b7a3825c384488540863fb3b8eab752cacb3b85a5",
      "afterSha": "f6f7e3c436ecb7758c6da76e6d0b174e772644a2631979d8a35327d5516af132",
      "edits": [
        {
          "name": "use pill",
          "expect": 1,
          "before": [
            "<Button asChild size=\"xl\">"
          ],
          "after": [
            "<Button asChild size=\"xl\" className=\"rounded-full shadow-none\">"
          ]
        },
        {
          "name": "demo pill",
          "expect": 1,
          "before": [
            "<Button asChild variant=\"outline\" size=\"xl\">"
          ],
          "after": [
            "<Button asChild variant=\"outline\" size=\"xl\" className=\"rounded-full shadow-none\">"
          ]
        },
        {
          "name": "screenshot radius",
          "expect": 1,
          "before": [
            "className=\"h-auto w-full rounded-2xl border border-border\""
          ],
          "after": [
            "className=\"h-auto w-full rounded-lg border border-border\""
          ]
        },
        {
          "name": "tier chip",
          "expect": 1,
          "before": [
            "className=\"inline-flex w-fit items-center rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground\""
          ],
          "after": [
            "className=\"inline-flex w-fit items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/ui/separator.tsx",
      "beforeSha": "70b278bbbfd1f0de60dd36f3d2ac5fc257856958f999ab37c4c0c3d77fd63974",
      "afterSha": "43800f854578a6ec3f031a38ef41ae761db25b80f9737e44a0249ae0ab895a28",
      "edits": [
        {
          "name": "drop use client",
          "expect": 1,
          "before": [
            "\"use client\"",
            "",
            ""
          ],
          "after": [
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/ui/sheet.tsx",
      "beforeSha": "d6bfa79dd6807e9199702641a63afa741f296663090e274444a7af369faca740",
      "afterSha": "37dabd9bed195bb697cdb2965223fe2aa3725e968e62c133cc7c7b3ff32c9b79",
      "edits": [
        {
          "name": "drop use client",
          "expect": 1,
          "before": [
            "\"use client\"",
            "",
            ""
          ],
          "after": [
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/ui/toggle.tsx",
      "beforeSha": "de6873965a2ad3146bd72636954fdd969a4b400b6a00767c55b0950b25653c06",
      "afterSha": "97ba316b2eb6d329a2901bef7f37a510ab1d590260bd2bfe18d7926944857cf9",
      "edits": [
        {
          "name": "drop use client",
          "expect": 1,
          "before": [
            "\"use client\"",
            "",
            ""
          ],
          "after": [
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/package.json",
      "beforeSha": "475b3bada3baf0dfd705e7609e7f04560f0a7ec23545af77e1ebf7e6d272b117",
      "afterSha": "5534171185e76e2f08038c5c565dc6d80e21bce76d6b44d0bf910a08ccfe169e",
      "edits": [
        {
          "name": "scripts",
          "expect": 1,
          "before": [
            "    \"baseline:capture\": \"node scripts/baseline-capture.mjs\"",
            "  },"
          ],
          "after": [
            "    \"baseline:capture\": \"node scripts/baseline-capture.mjs\",",
            "    \"check:shadows\": \"node scripts/check-flat.mjs --strict\",",
            "    \"a11y:axe\": \"node scripts/a11y-axe.mjs\"",
            "  },"
          ]
        }
      ]
    }
  ],
  "create": [
    {
      "rel": "apps/storefront/scripts/a11y-axe.mjs",
      "lines": [
        "// @markaz/storefront:p3-p6-a11y",
        "// Runs axe on every marketing route at 375 and 1440 px. Exits 1 on serious or critical issues.",
        "// Not run by the patch. It needs dev-only tools:",
        "//   pnpm --filter @markaz/storefront add -D playwright @axe-core/playwright && pnpm exec playwright install chromium",
        "// Usage: node scripts/a11y-axe.mjs [--base-url http://localhost:3000] [--theme dark|light]",
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const root = path.resolve(fileURLToPath(new URL(\".\", import.meta.url)), \"..\");",
        "const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };",
        "const base = arg(\"base-url\", \"http://localhost:3000\");",
        "const theme = arg(\"theme\", \"dark\");",
        "",
        "let chromium, AxeBuilder;",
        "try {",
        "  ({ chromium } = await import(\"playwright\"));",
        "  ({ default: AxeBuilder } = await import(\"@axe-core/playwright\"));",
        "} catch {",
        "  console.error(\"Missing dev tools. See the header of this file.\");",
        "  process.exit(1);",
        "}",
        "",
        "const themesSrc = fs.readFileSync(path.join(root, \"content/marketing/themes.ts\"), \"utf8\");",
        "const slugs = [...themesSrc.matchAll(/slug:\\s*[\"'`]([\\w-]+)[\"'`]/g)].map((m) => m[1]);",
        "const routes = [",
        "  \"/\", \"/features\", \"/pricing\", \"/themes\", \"/about\", \"/contact\",",
        "  \"/legal/privacy\", \"/legal/terms\", \"/legal/refunds\", \"/legal/cookies\",",
        "  ...slugs.map((s) => `/themes/${s}`),",
        "];",
        "",
        "const browser = await chromium.launch();",
        "let blocking = 0;",
        "for (const width of [375, 1440]) {",
        "  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });",
        "  await ctx.addInitScript((t) => { try { localStorage.setItem(\"theme\", t); } catch {} }, theme);",
        "  const page = await ctx.newPage();",
        "  for (const route of routes) {",
        "    try {",
        "      await page.goto(base + route, { waitUntil: \"networkidle\", timeout: 45000 });",
        "      const { violations } = await new AxeBuilder({ page }).withTags([\"wcag2a\", \"wcag2aa\", \"wcag21aa\"]).analyze();",
        "      const bad = violations.filter((v) => v.impact === \"serious\" || v.impact === \"critical\");",
        "      blocking += bad.length;",
        "      console.log(`${bad.length ? \"FAIL\" : \"PASS\"}  ${width}  ${route}  (${violations.length} total, ${bad.length} serious or critical)`);",
        "      bad.forEach((v) => console.log(`        ${v.impact}  ${v.id}  ${v.help}  (${v.nodes.length} nodes)`));",
        "    } catch (e) { blocking++; console.log(`ERR   ${width}  ${route}  ${String(e.message).split(\"\\n\")[0]}`); }",
        "  }",
        "  await ctx.close();",
        "}",
        "await browser.close();",
        "console.log(`a11y:axe  ${blocking === 0 ? \"PASS\" : \"FAIL\"}  (${blocking} serious or critical)`);",
        "process.exit(blocking === 0 ? 0 : 1);",
        ""
      ]
    }
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
    [M.strictFlat ? "check:shadows" : "check:flat (report-only)", "check-flat.mjs", M.strictFlat ? ["--strict"] : []],
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

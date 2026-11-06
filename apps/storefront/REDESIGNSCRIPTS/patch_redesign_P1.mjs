#!/usr/bin/env node
// apps/storefront/REDESIGNSCRIPTS/patch_redesign_P1.mjs
//
// Markazify redesign, phase P1: marketing shell (header, mobile sheet, footer, legal document)
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
  "phase": "P1",
  "allow": [
    "apps/storefront/components/marketing/layout/**",
    "apps/storefront/app/(marketing)/layout.tsx",
    "apps/storefront/content/marketing/nav.ts",
    "apps/storefront/content/marketing/footer.ts"
  ],
  "notes": [
    "Header: 56px, hairline border, text links, text Log in, one Start free pill. The theme toggle (an icon) moved from the header to the footer so the bar has no icons.",
    "The mobile menu button keeps its icon (a hamburger has no text form). Sheet, ActiveLink and aria-current are unchanged.",
    "content/marketing/footer.ts: added groups Features, Resources and Support (only existing routes and home-page anchors) and reordered Legal. nav.ts is untouched. Review the new link labels.",
    "Footer WhatsApp and email render in the Support column once SUPPORT_CONTACT has values."
  ],
  "manual": [
    "Keyboard, desktop: Tab from the skip link through logo, nav links, Log in, Start free. Each shows a ring.",
    "Keyboard, 375 px: Tab to the menu button, Enter opens the sheet, Tab walks the links, Escape closes it and focus returns to the button.",
    "Keyboard, footer: Tab through every link and the theme button. Each shows a ring."
  ],
  "modify": [
    {
      "rel": "apps/storefront/components/marketing/layout/header-wrapper.tsx",
      "beforeSha": "84f19c1aa44b792eaaacf5da1e0843454c83e4cfe0039013d2b8430872fa3d60",
      "afterSha": "53c1bdae99deb15986e3c820d0e786714bf22faf59d721dec68d516efa2463a3",
      "edits": [
        {
          "name": "hairline header",
          "expect": 1,
          "before": [
            "        \"sticky top-0 z-40 w-full transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300\",",
            "        scrolled ",
            "          ? \"border-b border-border bg-background/80 backdrop-blur-md shadow-xs\" ",
            "          : \"border-b border-transparent bg-background/60\"",
            ""
          ],
          "after": [
            "        \"sticky top-0 z-40 w-full border-b border-border transition-[background-color,backdrop-filter] duration-(--dur-base)\",",
            "        scrolled ? \"bg-background/80 backdrop-blur-md\" : \"bg-background\"",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/layout/site-header.tsx",
      "beforeSha": "0496c1face5b07d2273b7bfceae341ac442f22f3649350e8b3140d35f1191359",
      "afterSha": "dff2506ae6c15ba79abb29a4375b20a161f48087174872b6c428e88667192625",
      "edits": [
        {
          "name": "remove theme toggle import",
          "expect": 1,
          "before": [
            "import { ThemeToggle } from \"@/components/shared/theme-toggle\";",
            ""
          ],
          "after": [
            ""
          ]
        },
        {
          "name": "56px header, text links, one pill",
          "expect": 1,
          "before": [
            "      <Container className=\"flex h-16 items-center justify-between\">",
            "        <div className=\"flex items-center gap-8\">",
            "          <BrandMark />",
            "          <nav aria-label=\"Main navigation\" className=\"hidden lg:flex items-center gap-6\">",
            "            {navLinks.map((link) => (",
            "              <ActiveLink",
            "                key={link.href}",
            "                href={link.href}",
            "                className=\"text-sm font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm px-1 py-0.5\"",
            "              >",
            "                {link.label}",
            "              </ActiveLink>",
            "            ))}",
            "          </nav>",
            "        </div>",
            "        <div className=\"flex items-center gap-2\">",
            "          <div className=\"hidden lg:flex items-center gap-2\">",
            "            <Button asChild variant=\"ghost\" className=\"min-h-11 font-semibold text-sm px-4\">",
            "              <a href={getSellerPortalUrl(\"login\")}>Log in</a>",
            "            </Button>",
            "            <Button asChild className=\"min-h-11 font-semibold text-sm px-5\">",
            "              <a href={getSellerPortalUrl(\"signup\")}>Start free</a>",
            "            </Button>",
            "          </div>",
            "          <ThemeToggle />",
            "          <MobileNav />",
            "        </div>",
            "      </Container>",
            ""
          ],
          "after": [
            "      <Container className=\"flex h-14 items-center justify-between\">",
            "        <div className=\"flex items-center gap-6\">",
            "          <BrandMark />",
            "          <nav aria-label=\"Main navigation\" className=\"hidden items-center gap-1 lg:flex\">",
            "            {navLinks.map((link) => (",
            "              <ActiveLink",
            "                key={link.href}",
            "                href={link.href}",
            "                className=\"rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring\"",
            "              >",
            "                {link.label}",
            "              </ActiveLink>",
            "            ))}",
            "          </nav>",
            "        </div>",
            "        <div className=\"flex items-center gap-1\">",
            "          <div className=\"hidden items-center gap-2 lg:flex\">",
            "            <Button asChild variant=\"ghost\" className=\"h-9 px-3 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground\">",
            "              <a href={getSellerPortalUrl(\"login\")}>Log in</a>",
            "            </Button>",
            "            <Button asChild className=\"h-9 rounded-full px-4 text-sm font-medium shadow-none\">",
            "              <a href={getSellerPortalUrl(\"signup\")}>Start free</a>",
            "            </Button>",
            "          </div>",
            "          <MobileNav />",
            "        </div>",
            "      </Container>",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/layout/mobile-nav.tsx",
      "beforeSha": "91f1e69333651a43afac0156a4f17d72dc3efecb3576204792cc4f440f9fef51",
      "afterSha": "d9a414883d4e9f62e24da84a1cfa61dc3bf4e0f2ab986374c676180505e99633",
      "edits": [
        {
          "name": "mobile nav list",
          "expect": 1,
          "before": [
            "<nav aria-label=\"Mobile navigation\" className=\"flex flex-col gap-4\">"
          ],
          "after": [
            "<nav aria-label=\"Mobile navigation\" className=\"flex flex-col\">"
          ]
        },
        {
          "name": "mobile nav link",
          "expect": 1,
          "before": [
            "className=\"flex min-h-12 items-center text-lg font-medium text-foreground transition-colors hover:text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md px-2\""
          ],
          "after": [
            "className=\"flex min-h-12 items-center border-b border-border px-2 text-base font-medium text-foreground transition-colors outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring\""
          ]
        },
        {
          "name": "mobile primary pill",
          "expect": 1,
          "before": [
            "className=\"min-h-12 w-full text-base font-semibold\""
          ],
          "after": [
            "className=\"min-h-12 w-full rounded-full text-base font-medium shadow-none\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/layout/site-footer.tsx",
      "beforeSha": "fba380647f2c5e010ff93fd22067f42c56015c6e0bbea2030d079a58e4524277",
      "afterSha": "7c60a3769835711f1b0f792c5c012831f87a2b00b00e8f38ddc1ea88417300f8",
      "edits": [
        {
          "name": "footer imports",
          "expect": 1,
          "before": [
            "import { BRAND } from \"@/lib/brand\";",
            ""
          ],
          "after": [
            "import { ThemeToggle } from \"@/components/shared/theme-toggle\";",
            "import { BRAND } from \"@/lib/brand\";",
            ""
          ]
        },
        {
          "name": "footer body",
          "expect": 1,
          "before": [
            "const LINK =",
            "  \"inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50\";",
            "",
            "export function SiteFooter() {",
            "  const year = new Date().getFullYear();",
            "  const { whatsapp, email } = SUPPORT_CONTACT;",
            "",
            "  return (",
            "    <footer className=\"mt-auto border-t border-border bg-background\">",
            "      <div className=\"mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8\">",
            "        <div className=\"grid grid-cols-2 gap-8 md:grid-cols-3\">",
            "          {Object.entries(footerColumns).map(([title, links]) => (",
            "            <nav key={title} aria-label={title}>",
            "              <p className=\"text-sm font-semibold uppercase tracking-wider text-foreground\">{title}</p>",
            "              <ul className=\"mt-3 space-y-1\">",
            "                {links.map((link) => (",
            "                  <li key={link.label}>",
            "                    <Link href={link.href} className={LINK}>",
            "                      {link.label}",
            "                    </Link>",
            "                  </li>",
            "                ))}",
            "              </ul>",
            "            </nav>",
            "          ))}",
            "        </div>",
            "",
            "        {(whatsapp || email) && (",
            "          <div className=\"mt-10 flex flex-col gap-2 border-t border-border pt-8 text-sm text-muted-foreground sm:flex-row sm:gap-6\">",
            "            {whatsapp && (",
            "              <a href={`https://wa.me/${whatsapp}`} className={LINK}>",
            "                WhatsApp support",
            "              </a>",
            "            )}",
            "            {email && (",
            "              <a href={`mailto:${email}`} className={LINK}>",
            "                {email}",
            "              </a>",
            "            )}",
            "          </div>",
            "        )}",
            "",
            "        <p className=\"mt-10 border-t border-border pt-8 text-sm text-muted-foreground\">",
            "          &copy; {year} {BRAND.name}. All rights reserved.",
            "        </p>",
            "      </div>",
            "    </footer>",
            "  );",
            "}",
            ""
          ],
          "after": [
            "const LINK =",
            "  \"inline-flex min-h-10 items-center rounded-sm text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring\";",
            "",
            "export function SiteFooter() {",
            "  const year = new Date().getFullYear();",
            "  const { whatsapp, email } = SUPPORT_CONTACT;",
            "  const columns = Object.entries(footerColumns).filter(([title]) => title !== \"Legal\");",
            "  const legal = footerColumns.Legal ?? [];",
            "",
            "  return (",
            "    <footer className=\"mt-auto border-t border-border bg-background\">",
            "      <div className=\"mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8\">",
            "        <div className=\"grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5\">",
            "          {columns.map(([title, links]) => (",
            "            <nav key={title} aria-label={title}>",
            "              <p className=\"text-sm font-medium text-foreground\">{title}</p>",
            "              <ul className=\"mt-3 space-y-0.5\">",
            "                {links.map((link) => (",
            "                  <li key={link.label}>",
            "                    <Link href={link.href} className={LINK}>",
            "                      {link.label}",
            "                    </Link>",
            "                  </li>",
            "                ))}",
            "                {title === \"Support\" && whatsapp && (",
            "                  <li>",
            "                    <a href={`https://wa.me/${whatsapp}`} className={LINK}>",
            "                      WhatsApp support",
            "                    </a>",
            "                  </li>",
            "                )}",
            "                {title === \"Support\" && email && (",
            "                  <li>",
            "                    <a href={`mailto:${email}`} className={LINK}>",
            "                      {email}",
            "                    </a>",
            "                  </li>",
            "                )}",
            "              </ul>",
            "            </nav>",
            "          ))}",
            "        </div>",
            "",
            "        <div className=\"mt-14 flex flex-col gap-4 border-t border-border pt-6 md:flex-row md:items-center md:justify-between\">",
            "          <p className=\"text-sm text-muted-foreground\">",
            "            &copy; {year} {BRAND.name}. All rights reserved.",
            "          </p>",
            "          <div className=\"flex flex-wrap items-center gap-x-6 gap-y-2\">",
            "            <nav aria-label=\"Legal\">",
            "              <ul className=\"flex flex-wrap gap-x-6\">",
            "                {legal.map((link) => (",
            "                  <li key={link.label}>",
            "                    <Link href={link.href} className={LINK}>",
            "                      {link.label}",
            "                    </Link>",
            "                  </li>",
            "                ))}",
            "              </ul>",
            "            </nav>",
            "            <ThemeToggle />",
            "          </div>",
            "        </div>",
            "      </div>",
            "    </footer>",
            "  );",
            "}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/components/marketing/layout/legal-document.tsx",
      "beforeSha": "ce40d57e49c56aa4f9b22fb4624c9da260da734a29a4b8f0e306fdc936f54d37",
      "afterSha": "b96af2ab356b052ec08497ed4f95885a7b4f32ff4a3f28d0f93993b12e32a312",
      "edits": [
        {
          "name": "draft note tokens",
          "expect": 1,
          "before": [
            "className=\"mb-10 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm font-medium text-foreground\""
          ],
          "after": [
            "className=\"mb-10 rounded-lg border border-warning/40 bg-warning-subtle p-4 text-sm font-medium text-warning-subtle-foreground\""
          ]
        },
        {
          "name": "body and heading tokens",
          "expect": 1,
          "before": [
            "className=\"space-y-5 text-base leading-relaxed text-muted-foreground [&_h2]:mt-10 [&_h2]:mb-2 [&_h2]:text-h3 [&_h2]:font-semibold [&_h2]:text-foreground\""
          ],
          "after": [
            "className=\"space-y-5 text-body leading-relaxed text-muted-foreground [&_h2]:mt-12 [&_h2]:mb-2 [&_h2]:text-h3 [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/app/(marketing)/layout.tsx",
      "beforeSha": "447393b96d3160f84ad26d19a4001bf961da4f5597b96037552e285330ac6569",
      "afterSha": "5bdef46fe296c3605146fcc1e794c30dbf72565e484efb568d3f4b11521487df",
      "edits": [
        {
          "name": "skip link focus ring",
          "expect": 1,
          "before": [
            "focus:px-4 focus:py-2 focus:text-foreground\""
          ],
          "after": [
            "focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring\""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/content/marketing/footer.ts",
      "beforeSha": "1be36a788ed38ac09b4f2801cafc79c54f87dfeb9819fc4cf80355b5497d77ce",
      "afterSha": "38145341da0e0ff2404e570f7596c030a3d1322a11d4ca4ab3030be29f2e9f26",
      "edits": [
        {
          "name": "five footer groups and legal order",
          "expect": 1,
          "before": [
            "  Product: [",
            "    { label: 'Features', href: '/features' },",
            "    { label: 'Themes', href: '/themes' },",
            "    { label: 'Pricing', href: '/pricing' }",
            "  ],",
            "  Company: [",
            "    { label: 'About Us', href: '/about' },",
            "    { label: 'Contact', href: '/contact' }",
            "  ],",
            "  Legal: [",
            "    { label: 'Terms of Service', href: '/legal/terms' },",
            "    { label: 'Privacy Policy', href: '/legal/privacy' },",
            "    { label: 'Cookie Policy', href: '/legal/cookies' },",
            "    { label: 'Refunds', href: '/legal/refunds' }",
            "  ]"
          ],
          "after": [
            "  Product: [",
            "    { label: 'Pricing', href: '/pricing' },",
            "    { label: 'Themes', href: '/themes' },",
            "    { label: 'How it works', href: '/#how-it-works' }",
            "  ],",
            "  Features: [",
            "    { label: 'Features', href: '/features' },",
            "    { label: 'Cash on Delivery', href: '/#features' },",
            "    { label: 'Payments & Couriers', href: '/#features' }",
            "  ],",
            "  Company: [",
            "    { label: 'About Us', href: '/about' }",
            "  ],",
            "  Resources: [",
            "    { label: 'FAQ', href: '/#faq' },",
            "    { label: 'Support', href: '/#support' }",
            "  ],",
            "  Support: [",
            "    { label: 'Contact', href: '/contact' }",
            "  ],",
            "  Legal: [",
            "    { label: 'Privacy Policy', href: '/legal/privacy' },",
            "    { label: 'Terms of Service', href: '/legal/terms' },",
            "    { label: 'Refunds', href: '/legal/refunds' },",
            "    { label: 'Cookie Policy', href: '/legal/cookies' }",
            "  ]"
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

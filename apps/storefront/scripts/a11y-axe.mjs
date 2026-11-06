// @markaz/storefront:p3-p6-a11y
// Runs axe on every marketing route at 375 and 1440 px. Exits 1 on serious or critical issues.
// Not run by the patch. It needs dev-only tools:
//   pnpm --filter @markaz/storefront add -D playwright @axe-core/playwright && pnpm exec playwright install chromium
// Usage: node scripts/a11y-axe.mjs [--base-url http://localhost:3000] [--theme dark|light]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const base = arg("base-url", "http://localhost:3000");
const theme = arg("theme", "dark");

let chromium, AxeBuilder;
try {
  ({ chromium } = await import("playwright"));
  ({ default: AxeBuilder } = await import("@axe-core/playwright"));
} catch {
  console.error("Missing dev tools. See the header of this file.");
  process.exit(1);
}

const themesSrc = fs.readFileSync(path.join(root, "content/marketing/themes.ts"), "utf8");
const slugs = [...themesSrc.matchAll(/slug:\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1]);
const routes = [
  "/", "/features", "/pricing", "/themes", "/about", "/contact",
  "/legal/privacy", "/legal/terms", "/legal/refunds", "/legal/cookies",
  ...slugs.map((s) => `/themes/${s}`),
];

const browser = await chromium.launch();
let blocking = 0;
for (const width of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  for (const route of routes) {
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      blocking += bad.length;
      console.log(`${bad.length ? "FAIL" : "PASS"}  ${width}  ${route}  (${violations.length} total, ${bad.length} serious or critical)`);
      bad.forEach((v) => console.log(`        ${v.impact}  ${v.id}  ${v.help}  (${v.nodes.length} nodes)`));
    } catch (e) { blocking++; console.log(`ERR   ${width}  ${route}  ${String(e.message).split("\n")[0]}`); }
  }
  await ctx.close();
}
await browser.close();
console.log(`a11y:axe  ${blocking === 0 ? "PASS" : "FAIL"}  (${blocking} serious or critical)`);
process.exit(blocking === 0 ? 0 : 1);

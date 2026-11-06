// @markaz/storefront:p0-guards
// Screenshots every marketing route (plus two demo-store routes as a leak check) at 375, 768, 1440.
// Not run by the P0 patch. Playwright is a dev-only tool and is imported lazily:
//   pnpm --filter @markaz/storefront add -D playwright && pnpm exec playwright install chromium
// Usage: node scripts/baseline-capture.mjs --label before|after [--base-url http://localhost:3000] [--theme dark|light]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const label = arg("label");
const base = arg("base-url", "http://localhost:3000");
const theme = arg("theme", "dark");
if (!label) { console.error("Missing --label before|after"); process.exit(1); }

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.error("Playwright is not installed. See the header of this file."); process.exit(1); }

const themesSrc = fs.readFileSync(path.join(root, "content/marketing/themes.ts"), "utf8");
const slugs = [...themesSrc.matchAll(/slug:\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1]);
const routes = [
  "/", "/features", "/pricing", "/themes", "/about", "/contact",
  "/legal/privacy", "/legal/terms", "/legal/refunds", "/legal/cookies",
  ...slugs.map((s) => `/themes/${s}`),
  ...(slugs[0] ? [`/demo/${slugs[0]}`, `/demo/${slugs[0]}/products`] : []),
];
const widths = [375, 768, 1440];
const outDir = path.join(root, "REDESIGNSCRIPTS", ".baseline", label);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
let n = 0;
for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  for (const route of routes) {
    const name = (route === "/" ? "home" : route.slice(1).replace(/\//g, "_")) + `__${width}.png`;
    try {
      const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 45000 });
      await page.screenshot({ path: path.join(outDir, name), fullPage: true });
      console.log(`${res?.status() ?? "?"}  ${route}  ${width}`);
      n++;
    } catch (e) { console.log(`ERR  ${route}  ${width}  ${String(e.message).split("\n")[0]}`); }
  }
  await ctx.close();
}
await browser.close();
console.log(`captured ${n} screenshots in ${path.relative(root, outDir)}`);

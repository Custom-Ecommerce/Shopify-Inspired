// @markaz/storefront:p0-guards
// Counts shadow utilities in marketing and shared code. Report-only until P6 removes resting shadows.
// Run with --strict to fail when the count is above the target (10).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const targets = ["app/(marketing)", "components/marketing", "components/shared"];
const TARGET = 10;
const re = /(?<![\w-])(?:[\w-]+:)*shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)(?![\w-])/g;

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) { if (/\.(tsx?|css)$/.test(p)) out.push(p); return out; }
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);
  return out;
}

let total = 0;
const per = [];
for (const t of targets) {
  for (const file of walk(path.join(root, t))) {
    const n = (fs.readFileSync(file, "utf8").match(re) || []).length;
    if (n) { total += n; per.push([path.relative(root, file).split(path.sep).join("/"), n]); }
  }
}
if (process.argv.includes("--list")) per.forEach(([f, n]) => console.log(`${String(n).padStart(3)}  ${f}`));
const strict = process.argv.includes("--strict");
const ok = total <= TARGET;
console.log(`check:flat  ${ok ? "PASS" : strict ? "FAIL" : "INFO"}  (${total} shadow utilities, target ${TARGET}${strict ? "" : ", report-only until P6"})`);
process.exit(strict && !ok ? 1 : 0);

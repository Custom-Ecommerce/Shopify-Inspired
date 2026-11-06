// @markaz/storefront:p0-guards
// No Tailwind palette classes and no arbitrary colour classes in the redesign scope.
// Scope matches check-tokens. app/(system) and app/(store) are out of scope. Zero dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const targets = ["app/(marketing)", "app/layout.tsx", "components/marketing", "components/shared", "components/ui"];
const exts = new Set([".ts", ".tsx"]);

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) { if (exts.has(path.extname(p))) out.push(p); return out; }
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);
  return out;
}

const palette = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const util = "bg|text|border|ring|ring-offset|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder";
const rules = [
  ["palette class", new RegExp(`(?<![\\w-])(?:${util})-(?:${palette})-\\d{2,3}(?![\\w-])`)],
  ["raw white or black class", /(?<![\w-])(?:bg|text|border|ring|from|via|to|fill|stroke)-(?:white|black)(?![\w-])/],
  ["arbitrary colour class", /(?<![\w-])(?:bg|text|border|ring|from|via|to|fill|stroke|shadow)-\[(?:#|rgb|hsl|oklch|color:)/],
];

let fail = 0;
for (const t of targets) {
  for (const file of walk(path.join(root, t))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      for (const [name, re] of rules) {
        if (re.test(line)) { fail++; console.log(`FAIL  ${rel}:${i + 1}  ${name}: ${line.trim().slice(0, 100)}`); }
      }
    });
  }
}
console.log(`check:classes  ${fail === 0 ? "PASS" : "FAIL"}  (${fail} violations)`);
process.exit(fail === 0 ? 0 : 1);

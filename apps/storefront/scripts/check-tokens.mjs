// @markaz/storefront:p0-guards
// No colour literal outside styles/tokens.css. Scope: marketing routes, marketing and shared
// components, ui primitives, content, root layout and globals.css. Zero dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const targets = [
  "app/(marketing)", "app/layout.tsx", "app/globals.css",
  "components/marketing", "components/shared", "components/ui", "content/marketing",
];
const exts = new Set([".ts", ".tsx", ".css", ".mjs"]);

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) { if (exts.has(path.extname(p))) out.push(p); return out; }
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);
  return out;
}

const rules = [
  ["hex literal", /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/],
  ["oklch literal", /\boklch\(/],
  ["rgb literal", /\brgba?\(/],
  ["hsl literal", /\bhsla?\(/],
];

let fail = 0;
for (const t of targets) {
  for (const file of walk(path.join(root, t))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // The viewport themeColor in the root layout is browser chrome metadata, not UI colour.
      if (rel === "app/layout.tsx" && /color:\s*"#[0-9a-fA-F]{3,8}"/.test(line)) return;
      for (const [name, re] of rules) {
        if (re.test(line)) { fail++; console.log(`FAIL  ${rel}:${i + 1}  ${name}: ${line.trim().slice(0, 100)}`); }
      }
    });
  }
}
console.log(`check:tokens  ${fail === 0 ? "PASS" : "FAIL"}  (${fail} violations)`);
process.exit(fail === 0 ? 0 : 1);

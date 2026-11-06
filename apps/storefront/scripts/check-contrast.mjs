// @markaz/storefront:p0-guards
// WCAG AA contrast for token pairs in both themes. Reads styles/tokens.css. Zero dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "styles", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector) {
  const m = css.match(new RegExp("(?:^|\\n)" + selector + "\\s*\\{([\\s\\S]*?)\\n\\}", "m"));
  if (!m) throw new Error("tokens.css: block not found: " + selector);
  const map = {};
  for (const d of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) map[d[1]] = d[2].trim();
  return map;
}
const light = block(":root");
const dark = { ...light, ...block("\\.dark") };

const clamp = (x) => Math.min(1, Math.max(0, x));
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function oklchToSrgb(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => toGamma(clamp(c))); // gamma-encoded sRGB 0..1
}

function resolve(map, name, depth = 0) {
  let v = map[name];
  if (v === undefined || depth > 8) return null;
  const alias = v.match(/^var\(--([\w-]+)\)$/);
  if (alias) return resolve(map, alias[1], depth + 1);
  const m = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\s*\)$/);
  if (!m) return null; // color-mix and other functions are not checked
  const alpha = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { rgb: oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])), alpha };
}

function over(fg, bg) {
  return fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha));
}
function luminance(rgbGamma) {
  const [r, g, b] = rgbGamma.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fgName, bgName, map) {
  const fg = resolve(map, fgName);
  const bg = resolve(map, bgName);
  if (!fg || !bg) return null;
  const base = bg.alpha < 1 ? { rgb: over(bg, resolve(map, "background")), alpha: 1 } : bg;
  const l1 = luminance(fg.alpha < 1 ? over(fg, base) : fg.rgb);
  const l2 = luminance(base.rgb);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const surfaces = ["background", "card", "surface-1", "surface-2"];
const text = [
  ["foreground", "background"], ["foreground", "surface-1"], ["foreground", "surface-2"],
  ["card-foreground", "card"], ["popover-foreground", "popover"],
  ["primary", "background"], ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"], ["accent-foreground", "accent"],
  ["primary", "primary-soft"],
  ...surfaces.map((s) => ["muted-foreground", s]),
  ...surfaces.map((s) => ["text-tertiary", s]),
  ["muted-foreground", "secondary"],
  ...["destructive", "success", "warning", "info"].flatMap((k) => [
    [`${k}-foreground`, k],
    [`${k}-subtle-foreground`, `${k}-subtle`],
    [`${k}-subtle-foreground`, "background"],
  ]),
];
const ui = [["ring", "background"], ["ring", "card"], ["ring", "surface-1"]];

let fail = 0;
let skipped = 0;
for (const [themeName, map] of [["light", light], ["dark", dark]]) {
  for (const [list, min, kind] of [[text, 4.5, "text"], [ui, 3, "ui"]]) {
    for (const [fg, bg] of list) {
      const r = ratio(fg, bg, map);
      if (r === null) { skipped++; continue; }
      const ok = r >= min;
      if (!ok) fail++;
      if (!ok || process.argv.includes("--all")) {
        console.log(`${ok ? "pass" : "FAIL"}  ${themeName.padEnd(5)} ${kind.padEnd(4)} ${fg} on ${bg}  ${r.toFixed(2)} (min ${min})`);
      }
    }
  }
}
console.log(`check:contrast  ${fail === 0 ? "PASS" : "FAIL"}  (${fail} failing, ${skipped} pairs skipped: unresolved)`);
process.exit(fail === 0 ? 0 : 1);

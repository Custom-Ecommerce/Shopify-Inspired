export type Oklch = [number, number, number];

export function parseOklch(value: string): Oklch {
  const m = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/.exec(value.trim());
  if (!m) throw new Error("not an oklch colour without alpha: " + value);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function linearSrgb([L, C, h]: Oklch): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = linearSrgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const ya = relativeLuminance(a);
  const yb = relativeLuminance(b);
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

/** The custom properties declared in one top-level block of globals.css. */
export function parseTokenBlock(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const text = "\n" + css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = text.indexOf("\n" + selector + " {");
  if (start === -1) throw new Error("block not found: " + selector);
  const open = text.indexOf("{", start);
  const close = text.indexOf("}", open);
  const tokens: Record<string, string> = {};
  for (const m of text.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** Resolves a token to a colour, following var() references. Layers are searched in order (dark first, then root). */
export function resolveToken(name: string, layers: Array<Record<string, string>>, depth = 0): Oklch {
  if (depth > 10) throw new Error("token reference loop at " + name);
  for (const layer of layers) {
    const value = layer[name];
    if (value === undefined) continue;
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    return ref ? resolveToken(ref[1], layers, depth + 1) : parseOklch(value);
  }
  throw new Error("token not defined: " + name);
}

/** Control boundaries that must reach 3:1 against the surface they sit on, in both modes (WCAG 1.4.11). */
export const NON_TEXT_PAIRS: Array<[string, string]> = [
  ["--input", "--background"],
  ["--input", "--card"],
];

/** Text and surface pairs that must reach 4.5:1 in both modes. */
export const CONTRAST_PAIRS: Array<[string, string]> = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--muted"],
  ["--accent-foreground", "--accent"],
  ["--destructive-foreground", "--destructive"],
  ["--primary", "--background"],
  ["--destructive", "--background"],
  ["--destructive", "--popover"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
  ["--status-success", "--status-success-soft"],
  ["--status-warning", "--status-warning-soft"],
  ["--status-danger", "--status-danger-soft"],
  ["--status-neutral", "--status-neutral-soft"],
];

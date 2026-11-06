import fs from "node:fs";
import path from "node:path";

export interface Violation {
  file: string;
  line: number;
  match: string;
  rule: string;
}

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIX = "bg|text|border|ring|fill|stroke|from|via|to|outline|divide|accent|caret|decoration|shadow|placeholder";

const RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "hex colour", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { rule: "colour function", pattern: /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/g },
  { rule: "palette utility", pattern: new RegExp("\\b(?:" + PREFIX + ")-(?:" + PALETTE + ")-\\d{2,3}\\b", "g") },
  { rule: "black or white utility", pattern: /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow)-(?:white|black)\b/g },
  { rule: "arbitrary named colour", pattern: new RegExp("\\b(?:" + PREFIX + ")-\\[(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|transparent)\\]", "g") },
  { rule: "named colour in style", pattern: /\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*["'](?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)["']/g },
];

/** Colour values outside the tokens in one file's text. */
export function findViolations(text: string, file = "<input>"): Violation[] {
  const found: Violation[] = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    for (const { rule, pattern } of RULES) {
      for (const match of lineText.matchAll(pattern)) {
        found.push({ file, line: index + 1, match: match[0], rule });
      }
    }
  });
  return found;
}

export const SCANNED_DIRS = ["app", "components", "lib"];
export const EXEMPT_FILES = ["app/globals.css", "lib/token-rules.ts", "lib/contrast.ts"];
const EXTENSIONS = [".ts", ".tsx", ".css", ".mdx"];

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** Every colour literal under app, components, and lib, except in the exempt files. */
export function scanDirectory(root: string): Violation[] {
  const all: Violation[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of walk(path.join(root, dir), [])) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (EXEMPT_FILES.includes(rel)) continue;
      all.push(...findViolations(fs.readFileSync(file, "utf8"), rel));
    }
  }
  return all;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CONTRAST_PAIRS, NON_TEXT_PAIRS, contrastRatio, parseTokenBlock, resolveToken } from "../lib/contrast";

const css = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const root = parseTokenBlock(css, ":root");
const dark = parseTokenBlock(css, ".dark");
const MINIMUM = 4.5;

const MODES: Array<[string, Array<Record<string, string>>]> = [
  ["light", [root]],
  ["dark", [dark, root]],
];

test("the calculation is right: black on white is 21 to 1", () => {
  assert.ok(Math.abs(contrastRatio([0, 0, 0], [1, 0, 0]) - 21) < 0.05);
});

for (const [mode, layers] of MODES) {
  for (const [foreground, background] of CONTRAST_PAIRS) {
    test(mode + ": " + foreground + " on " + background + " reaches 4.5 to 1", () => {
      const ratio = contrastRatio(resolveToken(foreground, layers), resolveToken(background, layers));
      assert.ok(ratio >= MINIMUM, foreground + " on " + background + " is " + ratio.toFixed(2));
    });
  }
}

for (const [mode, layers] of MODES) {
  for (const [boundary, surface] of NON_TEXT_PAIRS) {
    test(mode + ": " + boundary + " on " + surface + " reaches 3 to 1", () => {
      const ratio = contrastRatio(resolveToken(boundary, layers), resolveToken(surface, layers));
      assert.ok(ratio >= 3, boundary + " on " + surface + " is " + ratio.toFixed(2));
    });
  }
}

test("the brand accent has a light and a dark value, so re-branding is a two-line change", () => {
  assert.ok(root["--brand-accent"]);
  assert.ok(dark["--brand-accent"]);
  assert.ok(root["--brand-accent-foreground"]);
  assert.ok(dark["--brand-accent-foreground"]);
});

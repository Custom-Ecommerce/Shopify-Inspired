/*
 * SB-7 (re-verification bug 1, D-114/D-115): a native <dialog> whose className carries an unconditional display class (flex, grid, block, inline-flex ...)
 * is drawn while it is CLOSED, because the class overrides the user agent rule dialog:not([open]) { display: none }. The Mustafa mini-cart had it
 * (put on hold, D-115). This check scans the Stiletto theme, the storefront app and the shared storefront packages and fails if any <dialog> has such a
 * class without the closed state kept (hidden + open:flex style). Stiletto and the storefront use portalled Radix / base-ui sheets, which are not mounted
 * while closed, so today there is no <dialog> at all; the check keeps it that way.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd(), "..", "..");
const SCAN = ["themes/stiletto/src", "apps/storefront/app", "apps/storefront/components", "apps/storefront/lib", "packages/storefront-theme-kit/src", "packages/storefront-data/src", "packages/design-system/src"];
const DISPLAY = /(?:^|\s)(?:flex|grid|block|inline|inline-block|inline-flex|inline-grid|table|contents)(?=\s|$)/;

function files(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(files(full));
    else if (/\.(tsx|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every <dialog ...> opening tag of a source text, with its className string literals. */
export function dialogClassNames(source: string): string[] {
  const found: string[] = [];
  for (const tag of source.match(/<dialog\b[^>]*>/gs) ?? []) {
    const literal = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/s.exec(tag);
    found.push(literal ? (literal[1] ?? literal[2] ?? literal[3] ?? "") : "");
  }
  return found;
}

/** True when the class list would draw a closed dialog: a bare display class and no "hidden" that keeps the closed state. */
export function drawsWhenClosed(className: string): boolean {
  const bare = className.split(/\s+/).filter((token) => !token.includes(":")).join(" ");
  return DISPLAY.test(" " + bare + " ") && !/(?:^|\s)hidden(?=\s|$)/.test(bare);
}

// the rule itself
assert.equal(drawsWhenClosed("my-0 ms-auto flex h-dvh flex-col open:flex"), true, "the Mustafa mini-cart class: a bare flex draws the closed dialog");
assert.equal(drawsWhenClosed("my-0 ms-auto hidden h-dvh flex-col open:flex"), false, "hidden + open:flex keeps it closed");
assert.equal(drawsWhenClosed("grid place-items-center"), true);
assert.equal(drawsWhenClosed("w-full max-w-md rounded-lg p-0 backdrop:bg-black/40"), false, "no display class: the default stays");
assert.equal(drawsWhenClosed("open:flex md:grid"), false, "variants alone do not draw it when closed");
assert.deepEqual(dialogClassNames('<dialog ref={r} className="a flex b" onClick={x}>'), ["a flex b"]);

// the scan
let dialogs = 0;
const bad: string[] = [];
for (const dir of SCAN) {
  for (const file of files(join(root, dir))) {
    const classes = dialogClassNames(readFileSync(file, "utf8"));
    dialogs += classes.length;
    for (const className of classes) if (drawsWhenClosed(className)) bad.push(file.slice(root.length + 1) + ': "' + className.slice(0, 80) + '"');
  }
}
assert.deepEqual(bad, [], "a closed dialog would be visible: " + bad.join("; "));
console.log("closed-dialog: " + dialogs + " native <dialog> found in the Stiletto theme, the storefront and the shared packages; none draws while closed");

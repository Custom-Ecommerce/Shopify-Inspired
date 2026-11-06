// @markaz/storefront:p0-guards
// Fails if a changed path (git status) is outside the allowlist of the given phase.
// Usage: node scripts/check-scope.mjs P0
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const phase = process.argv[2];

// Paths are relative to the monorepo root. "**" matches anything below a folder.
const ALLOW = {
  P0: [
    "apps/storefront/scripts/**",
    "apps/storefront/styles/**",
    "apps/storefront/app/globals.css",
    "apps/storefront/app/layout.tsx",
    "apps/storefront/package.json",
  ],
};
const ALWAYS = ["apps/storefront/REDESIGNSCRIPTS/**"];

if (!phase || !ALLOW[phase]) {
  console.log(`check:scope  FAIL  (unknown phase "${phase ?? ""}". Known: ${Object.keys(ALLOW).join(", ")})`);
  process.exit(1);
}

const git = (...a) => execFileSync("git", a, { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let top;
let out;
try {
  top = git("rev-parse", "--show-toplevel").trim();
  out = git("status", "--porcelain", "-uall", "--", top);
} catch (e) {
  console.log("check:scope  FAIL  (git is not available or this is not a git checkout)");
  process.exit(1);
}

const match = (p, pat) => (pat.endsWith("/**") ? p.startsWith(pat.slice(0, -2)) : p === pat);
const changed = out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop());
const bad = changed.filter((p) => ![...ALLOW[phase], ...ALWAYS].some((pat) => match(p, pat)));
bad.forEach((p) => console.log(`FAIL  outside ${phase} allowlist: ${p}`));
console.log(`check:scope  ${bad.length === 0 ? "PASS" : "FAIL"}  (${changed.length} changed, ${bad.length} outside the ${phase} allowlist)`);
process.exit(bad.length === 0 ? 0 : 1);

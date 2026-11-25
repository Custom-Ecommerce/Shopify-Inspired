/*
 * Runs every *.check.ts of this theme, each in its own process, and fails if any fails. `pnpm --filter @markaz/theme-stiletto test` (and the root `pnpm test`).
 * CO-101: the Stiletto package had no test script, so its checks never ran in the workspace test. This is the same runner as packages/storefront-data/test.
 *
 * tsx is not a dependency of this package (adding one would change the lockfile). It is resolved from packages/storefront-data, which has it: each check
 * runs with that folder as the working directory (so `--import tsx` finds it) and the check file as an absolute path (so its own imports resolve from here).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tsxHome = join(here, "..", "..", "..", "packages", "storefront-data");
const files = readdirSync(here).filter((name) => name.endsWith(".check.ts")).sort();

let failed = 0;
for (const name of files) {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(here, name)], { cwd: tsxHome, encoding: "utf8" });
  const passed = result.status === 0;
  console.log((passed ? "pass  " : "FAIL  ") + name);
  if (!passed) {
    failed += 1;
    console.log(result.stdout + result.stderr);
  }
}

console.log(files.length - failed + " of " + files.length + " check files passed");
process.exit(failed === 0 && files.length > 0 ? 0 : 1);

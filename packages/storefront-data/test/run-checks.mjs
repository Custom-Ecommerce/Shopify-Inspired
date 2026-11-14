/* Runs every *.check.ts in this folder, each in its own process, and fails if any fails. `pnpm --filter @markaz/storefront-data test` */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((name) => name.endsWith(".check.ts")).sort();

let failed = 0;
for (const name of files) {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(here, name)], { cwd: dirname(here), encoding: "utf8" });
  const passed = result.status === 0;
  console.log((passed ? "pass  " : "FAIL  ") + name);
  if (!passed) {
    failed += 1;
    console.log(result.stdout + result.stderr);
  }
}

console.log(files.length - failed + " of " + files.length + " check files passed");
process.exit(failed === 0 ? 0 : 1);

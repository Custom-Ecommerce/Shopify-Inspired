import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations, scanDirectory } from "../lib/token-rules";

test("colour literals are found, each with its rule and line", () => {
  const text = [
    'const a = "#1d4ed8";',
    'const b = "rgb(0, 0, 0)";',
    'const c = "bg-red-500 text-slate-700";',
    'const d = "bg-white";',
    'const e = { color: "red" };',
  ].join("\n");
  const rules = findViolations(text).map((v) => v.rule);
  assert.deepEqual(rules, ["hex colour", "colour function", "palette utility", "palette utility", "black or white utility", "named colour in style"]);
});

test("semantic utilities and token references are allowed", () => {
  const text = 'className="bg-primary text-primary-foreground border-border bg-status-success-soft" style={{ boxShadow: "var(--elevation-card)" }}';
  assert.deepEqual(findViolations(text), []);
});

test("the admin frontend has no colour literal outside app/globals.css", () => {
  const violations = scanDirectory(process.cwd());
  assert.deepEqual(
    violations.map((v) => v.file + ":" + v.line + " " + v.match),
    [],
  );
});

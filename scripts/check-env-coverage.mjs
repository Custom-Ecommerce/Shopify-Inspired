// Fails when an app's source reads process.env.NAME and the app's .env.example does not list NAME.
// Usage: node scripts/check-env-coverage.mjs   (root script: pnpm check:env). Reads files only; starts nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const APPS = [
  'apps/storefront',
  'apps/seller/backend',
  'apps/seller/frontend',
  'apps/admin/backend',
  'apps/admin/frontend',
];

// S7-B5: names that are read through an env object passed as a parameter (so the scan above cannot see them) and are OPTIONAL. They must still
// be listed in the app's .env.example, so a deploy can find them; they are never required to be set.
export const OPTIONAL_LISTED = {
  'apps/seller/backend': ['CUSTOM_DOMAIN_CNAME_TARGET', 'CUSTOM_DOMAIN_A_TARGET', 'VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID', 'ROOT_DOMAIN', 'PLATFORM_HOSTNAMES'],
};

// Names the platform sets itself.
const PLATFORM_NAMES = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'CI', 'PORT']);
const PLATFORM_PREFIXES = ['VERCEL'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', 'test', 'tests', '__tests__', 'scripts', '.git']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEST_FILE = /\.(test|spec|check)\.[cm]?[tj]sx?$/;

function isPlatform(name) {
  return PLATFORM_NAMES.has(name) || PLATFORM_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (EXTENSIONS.has(path.extname(entry.name)) && !TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Every NAME read as process.env.NAME, process.env['NAME'] or `const { NAME } = process.env`. */
export function envNamesIn(text) {
  const names = new Set();
  for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g)) names.add(m[1]);
  for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].split('=')[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** NAME from every `NAME=` line, commented or not, of an .env.example. */
export function listedNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

function main() {
  let failed = false;
  for (const app of APPS) {
    const appDir = path.join(ROOT, app);
    const examplePath = path.join(appDir, '.env.example');
    if (!fs.existsSync(examplePath)) {
      console.log(app + ': MISSING .env.example');
      failed = true;
      continue;
    }
    const listed = listedNames(fs.readFileSync(examplePath, 'utf8'));
    const used = new Map();
    for (const file of walk(appDir, [])) {
      for (const name of envNamesIn(fs.readFileSync(file, 'utf8'))) {
        if (!used.has(name)) used.set(name, path.relative(ROOT, file).split(path.sep).join('/'));
      }
    }
    for (const name of OPTIONAL_LISTED[app] ?? []) if (!used.has(name)) used.set(name, '(optional, listed on purpose)');
    const missing = [...used.keys()].filter((name) => !isPlatform(name) && !listed.has(name)).sort();
    if (missing.length === 0) {
      console.log(app + ': ok (' + used.size + ' names read)');
    } else {
      failed = true;
      console.log(app + ': ' + missing.length + ' name(s) read in source but not in .env.example:');
      for (const name of missing) console.log('  ' + name + '   (first read in ' + used.get(name) + ')');
    }
  }
  if (failed) {
    console.log('\ncheck:env failed. Add each missing name to the app\'s .env.example (with a comment saying what it does).');
    process.exit(1);
  }
  console.log('\ncheck:env passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

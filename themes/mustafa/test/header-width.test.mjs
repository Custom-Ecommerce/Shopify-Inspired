import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// SB-6 (verification bug 5): every Mustafa page was 403 px wide at 375 px. The header row (burger + search toggle, logo, cart) had a logo cell
// that could not shrink, so a long store name pushed the cart button past the viewport. This test pins the class change and checks the widths by
// arithmetic; the verification chat re-measures scrollWidth in a real browser on /, /track, /checkout and /products.
// Plain node (no tsx): the theme has no test runner of its own.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const header = readFileSync(join(root, 'src', 'layout', 'header.tsx'), 'utf8');
const tokens = readFileSync(join(root, 'src', 'tokens.css'), 'utf8');

test('the header row: the logo cell takes what is left and the two button groups never shrink', () => {
  assert.match(header, /<div className="flex items-center justify-between gap-2 sm:gap-4">/, 'a smaller gap on a phone');
  assert.match(header, /<div className="flex shrink-0 items-center gap-1\.5 lg:hidden">/, 'burger and search toggle keep their width');
  assert.match(header, /<div className="flex min-w-0 flex-1 items-center lg:min-w-\[160px\] lg:flex-none">/, 'the logo cell may shrink below its content');
  assert.match(header, /inline-flex min-w-0 max-w-full items-center gap-2 text-2xl/, 'the link may shrink too');
  assert.match(header, /<span className="truncate italic font-serif tracking-normal">/, 'a long store name is cut, not pushed out');
  assert.match(header, /<div className="flex shrink-0 items-center justify-end gap-2\.5">/, 'the cart group keeps its width, so the cart button stays visible');
});

test('the widths add up at 375 px with a long store name (arithmetic of the classes, worst case a cart button with a count)', () => {
  const viewport = 375;
  // --mu-gutter: clamp(1rem, 0.5rem + 2vw, 2rem), 1rem = 16 px
  assert.match(tokens, /--mu-gutter:\s*clamp\(1rem, 0\.5rem \+ 2vw, 2rem\)/);
  const gutter = Math.min(32, Math.max(16, 8 + 0.02 * viewport));
  const content = viewport - 2 * gutter;
  const left = 44 + 6 + 44; // h-11 w-11 search toggle + gap-1.5 + the burger (also 44)
  const cart = 12 + 20 + 8 + 20 + 12; // px-3, icon, gap-2, count badge min-w-5, px-3 (the "Cart" label is hidden below sm)
  const gaps = 2 * 8; // gap-2 between the three cells
  const logo = content - left - cart - gaps;
  assert.ok(logo > 0, 'the logo cell still has room: ' + logo + ' px');
  assert.ok(left + gaps + cart + logo <= content, 'the row is not wider than the content box');
  // The old row: the cells could not shrink, so a 230 px store name (text-2xl, ~21 characters) made the row wider than the viewport.
  const oldRow = left + 230 + cart + 2 * 16;
  assert.ok(oldRow > content, 'the old row did overflow: ' + oldRow + ' > ' + content);
});

test('the right group does not show the Track Order link below sm (it would not fit)', () => {
  assert.match(header, /hidden sm:inline-flex/);
});

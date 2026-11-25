import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_CONFIG_DEFAULTS,
  THEME_CONFIG_KEYS,
  THEME_FONT_FAMILIES,
  THEME_FONT_STACKS,
  isDefaultThemeConfig,
  isNormalizedHex,
  normalizeHexColor,
  normalizeThemeLink,
  resolveThemeConfig,
  storeThemeConfigUpdateSchema,
  storefrontThemeConfigSchema,
  themeStyleVars,
  toStorefrontThemeConfig,
} from '../src/theme-config';
import { storeSettingsUpdateSchema } from '../src/store-settings';
import { failingPaths } from './helpers';

// S7-B7: the Stiletto theme config. Every value is validated and normalised; nothing a seller sends is ever a CSS string.

const parse = (body: unknown) => storeThemeConfigUpdateSchema.safeParse(body);
const ok = (body: unknown) => {
  const result = parse(body);
  assert.equal(result.success, true, JSON.stringify(body));
  return result.success ? result.data : null;
};

// ------------------------------------------------------------------------------------------------------- colours

test('a colour is #rgb or #rrggbb in any case and is stored as lower-case #rrggbb', () => {
  assert.equal(ok({ primaryColor: '#FFF' })!.primaryColor, '#ffffff');
  assert.equal(ok({ primaryColor: '#aBc' })!.primaryColor, '#aabbcc');
  assert.equal(ok({ primaryColor: '#1A2B3C' })!.primaryColor, '#1a2b3c');
  assert.equal(ok({ accentColor: ' #00ff7f ' })!.accentColor, '#00ff7f');
  assert.equal(normalizeHexColor('#000'), '#000000');
});

test('a colour that is anything else is refused, naming the field (names, functions, CSS, injection)', () => {
  const bad = [
    'red', 'rgb(0,0,0)', 'rgba(0,0,0,.5)', 'hsl(0,0%,0%)', '#12', '#1234', '#12345', '#1234567', '#gggggg', '123456', '#12 345', '',
    'url(https://evil.test/x.png)', 'url(javascript:alert(1))', 'expression(alert(1))', '#fff;background:url(x)', '#fff;}body{display:none', '#fff}',
    '#fff"', "#fff'", '#fff\n#000', '#fff<script>', '#fff/*', 'var(--x)', 'calc(1px)', '\\#fff', '#ＦＦＦ',
  ];
  for (const value of bad) {
    const result = parse({ primaryColor: value });
    assert.equal(result.success, false, JSON.stringify(value));
    if (!result.success) assert.deepEqual(failingPaths(result), ['primaryColor'], JSON.stringify(value));
  }
  for (const value of [null, 12, true, {}, ['#fff']]) assert.equal(parse({ accentColor: value }).success, false);
  assert.equal(parse({ primaryColor: '#' + 'f'.repeat(5000) }).success, false, 'very long');
  assert.equal(normalizeHexColor('red'), null);
  assert.equal(normalizeHexColor(null), null);
});

// ------------------------------------------------------------------------------------------------------- fonts

test('a font is a NAME from the whitelist, never a CSS string', () => {
  for (const name of THEME_FONT_FAMILIES) assert.equal(ok({ fontFamily: name })!.fontFamily, name);
  for (const bad of ['Arial', 'arial, sans-serif', 'serif;color:red', 'url(x)', '"Comic Sans"', 'SYSTEM', ' system', '', null, 1, 'inherit', "x'};body{display:none"]) {
    const result = parse({ fontFamily: bad });
    assert.equal(result.success, false, JSON.stringify(bad));
    if (!result.success) assert.deepEqual(failingPaths(result), ['fontFamily']);
  }
});

// ------------------------------------------------------------------------------------------------------- texts

test('the texts are plain text with their limits; an empty text clears the field', () => {
  const data = ok({ heroTitle: '  New   season ', heroSubtitle: 'Fresh\nlawn', heroCtaLabel: 'SHOP', announcementText: 'Free delivery' })!;
  assert.equal(data.heroTitle, 'New season');
  assert.equal(data.heroSubtitle, 'Fresh lawn');
  assert.equal(data.heroCtaLabel, 'SHOP');
  assert.equal(data.announcementText, 'Free delivery');
  for (const field of ['heroTitle', 'heroSubtitle', 'heroCtaLabel', 'announcementText', 'heroCtaLink']) {
    assert.equal((ok({ [field]: '' }) as Record<string, unknown>)[field], null, field + ' cleared with an empty string');
  }
  for (const field of ['heroTitle', 'heroSubtitle', 'heroCtaLabel', 'announcementText', 'heroCtaLink', 'heroImage']) {
    assert.equal((ok({ [field]: null }) as Record<string, unknown>)[field], null, field + ' cleared with null');
  }
  assert.equal(parse({ heroTitle: 'x'.repeat(80) }).success, true);
  assert.equal(parse({ heroTitle: 'x'.repeat(81) }).success, false);
  assert.equal(parse({ heroSubtitle: 'x'.repeat(161) }).success, false);
  assert.equal(parse({ heroCtaLabel: 'x'.repeat(31) }).success, false);
  assert.equal(parse({ announcementText: 'x'.repeat(121) }).success, false);
  assert.equal(parse({ heroTitle: 'x'.repeat(100000) }).success, false, 'very long');
});

test('a text with HTML is refused, whatever it is wrapped in', () => {
  for (const field of ['heroTitle', 'heroSubtitle', 'heroCtaLabel', 'announcementText']) {
    for (const value of ['<script>alert(1)</script>', 'a < b', 'a > b', '<img src=x onerror=alert(1)>', '</h1><h1>']) {
      const result = parse({ [field]: value });
      assert.equal(result.success, false, field + ' ' + value);
      if (!result.success) assert.deepEqual(failingPaths(result), [field]);
    }
  }
  for (const value of [12, true, {}, []]) assert.equal(parse({ heroTitle: value }).success, false);
});

// ------------------------------------------------------------------------------------------------------- links

test('a link is a path on this store or an https address', () => {
  for (const good of ['/', '/products', '/collections/shirts?sort=new', '/pages/about#top', 'https://wa.me/923001234567', 'https://shop.example.com/a?b=c']) {
    assert.equal(ok({ heroCtaLink: good })!.heroCtaLink, good, good);
  }
  assert.equal(normalizeThemeLink(' /products '), '/products');
});

test('a link that is anything else is refused: javascript, data, http, protocol-relative, user info, quotes, spaces, braces', () => {
  const bad = [
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
    'http://example.com', 'ftp://example.com', '//evil.test/x', '///evil.test', '\\\\evil.test', '/\\evil.test', 'evil.test', 'mailto:a@b.com', 'tel:0300',
    'https://user:pass@example.com', 'https://', 'https:///x', '/a b', '/a"onmouseover="x', "/a'b", '/a`b', '/{x}', '/a|b', '/<script>', 'https://a.com/<x>',
    'https://example.com/\u0000', '/a\tb', '/' + 'a'.repeat(300),
  ];
  for (const value of bad) {
    const result = parse({ heroCtaLink: value });
    assert.equal(result.success, false, JSON.stringify(value));
    if (!result.success) assert.deepEqual(failingPaths(result), ['heroCtaLink']);
  }
  assert.equal(normalizeThemeLink(null), null);
});

// ------------------------------------------------------------------------------------------------------- the image and switches

test('the hero image is a media id (the route checks it belongs to the store) or null; the switches are exact booleans', () => {
  assert.equal(ok({ heroImage: '65a0000000000000000c0001' })!.heroImage, '65a0000000000000000c0001');
  for (const bad of ['abc', 'https://x.com/a.png', '../../x', 12, true, '65a0000000000000000c000']) assert.equal(parse({ heroImage: bad }).success, false, String(bad));
  for (const key of ['announcementEnabled', 'showFeatured', 'showCategories', 'showReviews', 'showBlog']) {
    assert.equal(ok({ [key]: false })![key as 'showBlog'], false);
    for (const bad of ['true', 1, 0, null, 'on']) assert.equal(parse({ [key]: bad }).success, false, key + String(bad));
  }
});

test('the schema is strict: an unknown key is refused and named, whatever it looks like', () => {
  for (const extra of ['style', 'css', 'customCss', 'className', 'script', 'fontUrl', 'slug', 'themeConfig', '__proto__x', 'heroHtml']) {
    const result = parse({ primaryColor: '#fff', [extra]: 'x' });
    assert.equal(result.success, false, extra);
  }
  assert.equal(parse({}).success, true, 'an empty group is valid here; the settings body needs a change elsewhere');
  const unknown = storeSettingsUpdateSchema.safeParse({ themeConfig: { css: 'body{display:none}' } });
  assert.equal(unknown.success, false);
});

test('the settings body takes the themeConfig group, null resets it, and a bad value names themeConfig.<field>', () => {
  assert.equal(storeSettingsUpdateSchema.safeParse({ themeConfig: { primaryColor: '#ABC', showBlog: false } }).success, true);
  assert.equal(storeSettingsUpdateSchema.safeParse({ themeConfig: null }).success, true);
  const bad = storeSettingsUpdateSchema.safeParse({ themeConfig: { primaryColor: 'url(x)' } });
  assert.deepEqual(failingPaths(bad), ['themeConfig.primaryColor']);
});

// ------------------------------------------------------------------------------------------------------- defaults and resolve

test('the defaults are Stiletto itself: every section on, no hero override, its own colours and fonts', () => {
  assert.equal(THEME_CONFIG_DEFAULTS.primaryColor, '#111111');
  assert.equal(THEME_CONFIG_DEFAULTS.fontFamily, 'theme');
  for (const key of ['announcementEnabled', 'showFeatured', 'showCategories', 'showReviews', 'showBlog'] as const) assert.equal(THEME_CONFIG_DEFAULTS[key], true);
  for (const key of ['heroTitle', 'heroSubtitle', 'heroImage', 'heroCtaLabel', 'heroCtaLink', 'announcementText'] as const) assert.equal(THEME_CONFIG_DEFAULTS[key], null);
  assert.ok(isNormalizedHex(THEME_CONFIG_DEFAULTS.primaryColor) && isNormalizedHex(THEME_CONFIG_DEFAULTS.accentColor));
  assert.equal(Object.isFrozen(THEME_CONFIG_DEFAULTS), true);
  assert.equal(THEME_CONFIG_KEYS.length, 14);
});

test('resolve fills the defaults, keeps valid stored values, and falls back per field for a bad stored value (a hand-edited document never reaches a page)', () => {
  assert.deepEqual(resolveThemeConfig(undefined), THEME_CONFIG_DEFAULTS);
  assert.deepEqual(resolveThemeConfig(null), THEME_CONFIG_DEFAULTS);
  assert.deepEqual(resolveThemeConfig('nope'), THEME_CONFIG_DEFAULTS);
  assert.deepEqual(resolveThemeConfig([]), THEME_CONFIG_DEFAULTS);
  const stored = { primaryColor: '#abcdef', heroTitle: 'Hello', showBlog: false, accentColor: 'url(x)', fontFamily: 'Comic Sans', heroCtaLink: 'javascript:x', heroSubtitle: '<b>', extra: 'x' };
  const config = resolveThemeConfig(stored);
  assert.equal(config.primaryColor, '#abcdef');
  assert.equal(config.heroTitle, 'Hello');
  assert.equal(config.showBlog, false);
  assert.equal(config.accentColor, THEME_CONFIG_DEFAULTS.accentColor);
  assert.equal(config.fontFamily, 'theme');
  assert.equal(config.heroCtaLink, null);
  assert.equal(config.heroSubtitle, null);
  assert.equal('extra' in config, false);
  assert.deepEqual(resolveThemeConfig(config), config, 'idempotent');
  assert.equal(isDefaultThemeConfig(THEME_CONFIG_DEFAULTS), true);
  assert.equal(isDefaultThemeConfig(config), false);
});

test('the public config has the hero image as a URL and no media id, and is validated again by the storefront schema', () => {
  const config = resolveThemeConfig({ heroImage: '65a0000000000000000c0001', primaryColor: '#abc' });
  const pub = toStorefrontThemeConfig(config, 'https://res.cloudinary.com/x/hero.png');
  assert.equal(pub.heroImageUrl, 'https://res.cloudinary.com/x/hero.png');
  assert.equal('heroImage' in pub, false);
  assert.equal(storefrontThemeConfigSchema.safeParse(pub).success, true);
  assert.equal(storefrontThemeConfigSchema.safeParse({ ...pub, primaryColor: 'red' }).success, false, 'the storefront takes only a normalised hex');
});

// ------------------------------------------------------------------------------------------------------- the style builder

test('the style builder uses only a normalised hex and a whitelisted font NAME', () => {
  assert.deepEqual(themeStyleVars({ primaryColor: '#112233', accentColor: '#aabbcc', fontFamily: 'serif' }), {
    '--brand-primary': '#112233',
    '--promo-banner-button-bg': '#aabbcc',
    '--nav-cart-badge-bg': '#aabbcc',
    '--custom-sans': THEME_FONT_STACKS.serif,
    '--custom-heading': THEME_FONT_STACKS.serif,
  });
  assert.deepEqual(themeStyleVars({ primaryColor: '#112233', accentColor: '#aabbcc', fontFamily: 'theme' }), { '--brand-primary': '#112233', '--promo-banner-button-bg': '#aabbcc', '--nav-cart-badge-bg': '#aabbcc' });
  assert.deepEqual(themeStyleVars({}), {});
});

test('the style builder REJECTS anything that is not a normalised hex: short, upper case, names, functions, injections, non-strings', () => {
  const bad = ['#FFF', '#fff', '#AABBCC', ' #aabbcc', '#aabbcc ', '#aabbcc;', '#aabbcc}', '#aabbcc\n', 'red', 'rgb(0,0,0)', 'url(x)', 'expression(1)', 'var(--x)', '#aabbcc;background:url(x)', '', null, undefined, 12, {}, ['#aabbcc'], '#aabbccdd'];
  for (const value of bad) {
    assert.deepEqual(themeStyleVars({ primaryColor: value, accentColor: value }), {}, JSON.stringify(value));
    assert.equal(isNormalizedHex(value), false, JSON.stringify(value));
  }
  for (const font of ['Arial', 'serif;x', 'toString', '__proto__', 'constructor', 'hasOwnProperty', '', null, 5, 'SERIF']) assert.deepEqual(themeStyleVars({ fontFamily: font }), {}, JSON.stringify(font));
  // The only strings that ever reach a style value are the fixed stacks and normalised hex values: check every output against that.
  const stacks = new Set(Object.values(THEME_FONT_STACKS));
  for (const family of THEME_FONT_FAMILIES) {
    for (const [name, value] of Object.entries(themeStyleVars({ primaryColor: '#010203', accentColor: '#0a0b0c', fontFamily: family }))) {
      assert.ok(name.startsWith('--'), name);
      assert.ok(isNormalizedHex(value) || stacks.has(value), name + ' ' + value);
    }
  }
});

test('the font stacks are fixed strings without anything that could break out of a value', () => {
  for (const stack of Object.values(THEME_FONT_STACKS)) assert.equal(/[;{}<>\\]|url\(|expression/i.test(stack), false, stack);
  assert.deepEqual(Object.keys(THEME_FONT_STACKS).sort(), ['mono', 'rounded', 'serif', 'system']);
});

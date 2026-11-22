import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { Media, signSession, Store, User } from '@/lib/services';
import { SELLER_AUDIENCE } from '@/lib/accounts';
import { PlanLimitError } from '@/lib/http';
import { setPlanLoader, type EffectivePlan } from '../src/lib/plan';
import { assertThemeAllowedByPlan, themeLockFlags } from '../src/lib/theme-plan';
import { findMediaUsage, listMediaFeatures } from '../src/lib/media-usage';
import { toStorefrontStoreDto } from '../src/lib/storefront/store-dto';

// S7-B7 (D-115, D-118): the plan gate of a premium theme (built and tested with a FAKE premium manifest, because none exists today), the media registry entry of
// the theme config, the public record, and the themes list with its locked flag. Models are stubbed in memory. No database.

const SECRET = 'x'.repeat(40);
const USER = '65a000000000000000000001';
const STORE = '65a000000000000000000011';
const HERO = '65a0000000000000000c0001';
const OTHER_STORE = '65a000000000000000000012';

const FAKE = [
  { slug: 'stiletto', tier: 'free' },
  { slug: 'lux', tier: 'paid' },
] as const;

const planOf = (premiumThemes: boolean): EffectivePlan => ({
  key: premiumThemes ? 'growth' : 'free',
  name: premiumThemes ? 'Growth' : 'Free',
  status: 'active',
  subscribedPlanKey: premiumThemes ? 'growth' : null,
  limits: { stores: 1, products: 10, staffSeats: 0, apiKeys: 0, customDomain: false, premiumThemes },
  periodEnd: null,
  graceUntil: null,
  daysLeft: null,
  fallbackLimits: false,
});

const StoreModel = Store as any;
const MediaModel = Media as any;
const UserModel = User as any;
let restore: () => void;
let token = '';
let themesGET: (r: NextRequest) => Promise<Response>;

before(async () => {
  process.env.SELLER_AUTH_SECRET = SECRET;
  process.env.SELLER_MONGODB_URI = 'mongodb://stub.invalid/seller';
  token = await signSession({ sub: USER, role: 'seller' }, SECRET, SELLER_AUDIENCE);
  themesGET = (await import('../src/app/api/themes/route')).GET;
});

beforeEach(() => {
  const saved = { connect: (mongoose as any).connect, findOne: StoreModel.findOne, mediaFindOne: MediaModel.findOne, userFindById: UserModel.findById };
  (mongoose as any).connect = async () => mongoose;
  const q: any = { select: () => q, lean: async () => ({ emailVerifiedAt: new Date() }) };
  UserModel.findById = () => q;
  restore = () => {
    (mongoose as any).connect = saved.connect;
    StoreModel.findOne = saved.findOne;
    MediaModel.findOne = saved.mediaFindOne;
    UserModel.findById = saved.userFindById;
    setPlanLoader(null);
  };
});
afterEach(() => restore());

// ------------------------------------------------------------------------------------------------------- the plan gate

test('a premium theme is refused on the Free plan with PLAN_LIMIT_REACHED (premiumThemes) and allowed on Growth', async () => {
  setPlanLoader(async () => planOf(false));
  await assert.rejects(
    () => assertThemeAllowedByPlan(USER, 'lux', FAKE),
    (err: unknown) => err instanceof PlanLimitError && err.status === 403 && err.body.code === 'PLAN_LIMIT_REACHED' && err.body.limitKind === 'premiumThemes' && err.body.plan === 'free' && /Growth/.test(err.body.upgradeHint),
  );
  setPlanLoader(async () => planOf(true));
  await assertThemeAllowedByPlan(USER, 'lux', FAKE);
});

test('Stiletto (free) is never refused, on any plan, and an unknown theme is not a plan matter', async () => {
  setPlanLoader(async () => planOf(false));
  await assertThemeAllowedByPlan(USER, 'stiletto', FAKE);
  await assertThemeAllowedByPlan(USER, 'stiletto');
  await assertThemeAllowedByPlan(USER, 'no-such-theme', FAKE);
});

test('with the real manifest no installed theme is premium, so every theme a seller can choose passes on the Free plan', async () => {
  setPlanLoader(async () => {
    throw new Error('the plan must not even be read for a free theme');
  });
  await assertThemeAllowedByPlan(USER, 'stiletto');
});

test('the lock flags: locked only for a premium theme on a plan without premium themes', () => {
  assert.deepEqual(themeLockFlags('lux', false, FAKE), { premium: true, locked: true });
  assert.deepEqual(themeLockFlags('lux', true, FAKE), { premium: true, locked: false });
  assert.deepEqual(themeLockFlags('stiletto', false, FAKE), { premium: false, locked: false });
});

test('GET /api/themes lists Stiletto only, not premium and not locked, on a Free plan', async () => {
  setPlanLoader(async () => planOf(false));
  const res = await themesGET(new NextRequest('http://seller.test/api/themes', { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(res.status, 200);
  const { themes } = (await res.json()) as { themes: Array<{ slug: string; premium: boolean; locked: boolean }> };
  assert.deepEqual(themes.map((theme) => [theme.slug, theme.premium, theme.locked]), [['stiletto', false, false]]);
});

// ------------------------------------------------------------------------------------------------------- the media registry

test('the theme config is a registered media feature: a hero picture in use is reported, one that is not is free, and another store is never touched', async () => {
  const feature = listMediaFeatures().find((entry) => entry.key === 'themeConfig');
  assert.ok(feature, 'registered by importing media-usage');
  assert.match(feature!.label, /Theme/);
  const asked: any[] = [];
  StoreModel.findOne = (filter: any) => {
    asked.push(filter);
    const uses = String(filter._id) === STORE && filter['storefront.themeConfig.heroImage'] === HERO;
    return { select: () => ({ lean: async () => (uses ? { _id: STORE } : null) }) };
  };
  assert.deepEqual(await feature!.find(STORE, HERO), { count: 1, items: [{ id: 'heroImage', title: 'Home page hero picture' }] });
  assert.deepEqual(await feature!.find(STORE, '65a0000000000000000c0002'), { count: 0, items: [] }, 'a picture the config does not hold is free');
  assert.deepEqual(await feature!.find(OTHER_STORE, HERO), { count: 0, items: [] }, 'the question is always for one store');
  assert.ok(asked.every((filter) => 'storefront.themeConfig.heroImage' in filter && '_id' in filter));
});

test('findMediaUsage includes the theme config, so the delete route (which asks the registry) refuses a hero picture in use', async () => {
  const feature = listMediaFeatures().find((entry) => entry.key === 'themeConfig')!;
  assert.ok(feature);
  const { registerMediaFeature, unregisterMediaFeature, listMediaFeatures: list } = await import('../src/lib/media-usage');
  const others = list().filter((entry) => entry.key !== 'themeConfig');
  for (const other of others) unregisterMediaFeature(other.key);
  try {
    StoreModel.findOne = () => ({ select: () => ({ lean: async () => ({ _id: STORE }) }) });
    const usage = await findMediaUsage(STORE, HERO);
    assert.equal(usage.inUse, true);
    assert.deepEqual(usage.features.map((entry) => entry.key), ['themeConfig']);
    assert.equal(usage.total, 1);
  } finally {
    for (const other of others) registerMediaFeature(other);
  }
});

// ------------------------------------------------------------------------------------------------------- the public record

test('the public record carries the validated config with the defaults filled in, the hero as a URL of the store own media, and never the media id', async () => {
  MediaModel.findOne = (filter: any) => ({ select: () => ({ lean: async () => (String(filter._id) === HERO && String(filter.store) === STORE ? { url: 'https://res.cloudinary.com/x/hero.png' } : null) }) });
  const none = await toStorefrontStoreDto({ _id: STORE, slug: 'zara', name: 'Zara' });
  assert.deepEqual(none.themeConfig, {
    primaryColor: '#111111', accentColor: '#633e2b', fontFamily: 'theme', heroTitle: null, heroSubtitle: null, heroImageUrl: null, heroCtaLabel: null, heroCtaLink: null,
    announcementText: null, announcementEnabled: true, showFeatured: true, showCategories: true, showReviews: true, showBlog: true,
  });
  const set = await toStorefrontStoreDto({ _id: STORE, slug: 'zara', name: 'Zara', storefront: { themeConfig: { primaryColor: '#abc', heroTitle: 'Eid', heroImage: HERO, showBlog: false } } });
  assert.equal(set.themeConfig!.primaryColor, '#aabbcc');
  assert.equal(set.themeConfig!.heroTitle, 'Eid');
  assert.equal(set.themeConfig!.heroImageUrl, 'https://res.cloudinary.com/x/hero.png');
  assert.equal(set.themeConfig!.showBlog, false);
  assert.equal(JSON.stringify(set.themeConfig).includes(HERO), false, 'the media id stays on the seller side');
  // The same media id in another store gives no picture (media is looked up in the store itself).
  const foreign = await toStorefrontStoreDto({ _id: OTHER_STORE, slug: 'other', name: 'Other', storefront: { themeConfig: { heroImage: HERO } } });
  assert.equal(foreign.themeConfig!.heroImageUrl, null);
});

test('a stored config that fails its rules never reaches the public record: the default of that field is sent', async () => {
  const dto = await toStorefrontStoreDto({
    _id: STORE, slug: 'zara', name: 'Zara',
    storefront: { themeConfig: { primaryColor: 'url(https://evil.test)', accentColor: '#fff;x', fontFamily: 'Comic Sans', heroTitle: '<script>x</script>', heroCtaLink: 'javascript:alert(1)', announcementText: '<b>hi</b>' } },
  });
  assert.equal(dto.themeConfig!.primaryColor, '#111111');
  assert.equal(dto.themeConfig!.accentColor, '#633e2b');
  assert.equal(dto.themeConfig!.fontFamily, 'theme');
  assert.equal(dto.themeConfig!.heroTitle, null);
  assert.equal(dto.themeConfig!.heroCtaLink, null);
  assert.equal(dto.themeConfig!.announcementText, null);
});

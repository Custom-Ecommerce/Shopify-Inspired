import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_CHECKOUT_UNSUPPORTED_BY_THEME,
  CARD_CHECKOUT_UNSUPPORTED_MESSAGE,
  CARD_CHECKOUT_UNSUPPORTED_THEME_MESSAGE,
  storeSettingsSchema,
  storeSettingsUpdateSchema,
  themeListResponseSchema,
} from '../src/store-settings';

// SB-11 (V-06): the card-checkout flag a theme carries, and the code a refused switch answers with.

test('the code and the two messages are fixed strings the seller screens and the API share', () => {
  assert.equal(CARD_CHECKOUT_UNSUPPORTED_BY_THEME, 'CARD_CHECKOUT_UNSUPPORTED_BY_THEME');
  assert.match(CARD_CHECKOUT_UNSUPPORTED_MESSAGE, /cash on delivery/);
  assert.match(CARD_CHECKOUT_UNSUPPORTED_THEME_MESSAGE, /Turn cash on delivery on first/);
});

test('the theme list answer carries supportsCardCheckout for every theme', () => {
  const ok = themeListResponseSchema.safeParse({
    themes: [{ slug: 'stiletto', name: 'Stiletto', tier: 'free', previewImage: null, isDefaultForNewStores: true, supportsCardCheckout: true }],
  });
  assert.equal(ok.success, true);
  const missing = themeListResponseSchema.safeParse({
    themes: [{ slug: 'mustafa', name: 'Mustafa', tier: 'free', previewImage: null, isDefaultForNewStores: false }],
  });
  assert.equal(missing.success, false);
});

test('the settings answer carries the active theme and whether it supports card checkout', () => {
  const shape = storeSettingsSchema.shape.theme;
  assert.equal(shape.safeParse({ activeTheme: 'mustafa', supportsCardCheckout: false }).success, true);
  assert.equal(shape.safeParse({ activeTheme: 'mustafa' }).success, false);
});

test('a PATCH body may still send the theme and the payments switches together', () => {
  const parsed = storeSettingsUpdateSchema.safeParse({ theme: { activeTheme: 'stiletto' }, payments: { codEnabled: false, cardEnabled: true } });
  assert.equal(parsed.success, true);
});

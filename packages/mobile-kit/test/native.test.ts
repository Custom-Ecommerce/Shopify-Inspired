import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { ApiError, NetworkError } from '../src/core/errors';
import { cacheStorageKey, CACHE_MAX_AGE_MS } from '../src/core/offline/cache';
import { phoneStore } from '../src/native/async-storage';
import { isConnected } from '../src/native/network';
import { createQueryClient, persistOptionsFor, shouldRetry } from '../src/native/query';
import { secureSecretStore } from '../src/native/secure-store';
import { colors, MIN_TAP_TARGET } from '../src/theme';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(async () => undefined) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest.mock factory cannot use an import
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => undefined) }));

describe('phone adapters', () => {
  it('reads the secret store and forgets a value it cannot decrypt', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('stored').mockRejectedValueOnce(new Error('decrypt'));
    await expect(secureSecretStore.get('markaz.session.seller')).resolves.toBe('stored');
    await expect(secureSecretStore.get('markaz.session.seller')).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('markaz.session.seller');
    await secureSecretStore.set('k', 'v');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('k', 'v');
  });

  it('keeps ordinary data in the app storage', async () => {
    await phoneStore.set('markaz.cache.u1', 'a');
    expect(await phoneStore.get('markaz.cache.u1')).toBe('a');
    expect(await phoneStore.keys()).toContain('markaz.cache.u1');
    await phoneStore.remove('markaz.cache.u1');
    expect(await phoneStore.get('markaz.cache.u1')).toBeNull();
    expect(AsyncStorage).toBeTruthy();
  });

  it('is online unless the phone says there is no network', () => {
    expect([isConnected({ isConnected: true }), isConnected({ isConnected: null }), isConnected({ isConnected: false })]).toEqual([true, true, false]);
  });

  it('saves one cache per user, for as long as it stays in memory', () => {
    const options = persistOptionsFor('u1');
    expect(options.maxAge).toBe(CACHE_MAX_AGE_MS);
    expect(createQueryClient().getDefaultOptions().queries?.gcTime).toBe(CACHE_MAX_AGE_MS);
    expect(cacheStorageKey('u1')).not.toBe(cacheStorageKey('u2'));
  });

  it('retries a lost connection but not a refusal', () => {
    expect(shouldRetry(0, new NetworkError('offline'))).toBe(true);
    expect(shouldRetry(2, new NetworkError('offline'))).toBe(false);
    expect(shouldRetry(0, new ApiError({ status: 403, message: 'no' }))).toBe(false);
    expect(shouldRetry(0, new ApiError({ status: 503, message: 'down' }))).toBe(true);
  });

  it('has the design tokens the screens use', () => {
    expect(MIN_TAP_TARGET).toBeGreaterThanOrEqual(44);
    expect(Object.values(colors).every((value) => /^#[0-9a-f]{6}$/.test(value))).toBe(true);
  });
});

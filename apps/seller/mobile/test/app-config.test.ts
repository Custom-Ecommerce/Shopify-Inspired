import { APP_STORE_URLS, parseAppVersion } from '@markaz/auth/mobile-version';
import appJson from '../app.json';
import { DEV_API_PORT } from '../src/config';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0', hostUri: '192.168.1.5:8081' } } }));

describe('seller app configuration', () => {
  const { expo } = appJson;

  it('is the Android package the store link of the version gate points to', () => {
    expect(expo.platforms).toEqual(['android']);
    expect(APP_STORE_URLS.seller.endsWith(`id=${expo.android.package}`)).toBe(true);
  });

  it('has a version the version gate can read', () => {
    expect(parseAppVersion(expo.version)).not.toBeNull();
  });

  it('keeps cached shop data out of phone backups', () => {
    expect(expo.android.allowBackup).toBe(false);
  });

  it('talks to the seller backend port in development', () => {
    expect(DEV_API_PORT).toBe(4001);
  });
});

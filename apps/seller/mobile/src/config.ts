import { resolveApiUrl, type ApiUrlResult } from '@markaz/mobile-kit/core';
import Constants from 'expo-constants';

/** The seller backend's port on a developer's computer. */
export const DEV_API_PORT = 4001;

/** The seller website's port on a developer's computer. */
export const DEV_PORTAL_PORT = 3002;

/** What the app was built with. The version is the app's own (app.json), also inside Expo Go. */
export const appVersion: string = Constants.expoConfig?.version ?? '0.0.0';

export const apiUrl: ApiUrlResult = resolveApiUrl({
  // Written out in full: Expo replaces exactly this text when it builds the bundle.
  configured: process.env.EXPO_PUBLIC_API_URL,
  hostUri: Constants.expoConfig?.hostUri,
  devPort: DEV_API_PORT,
  dev: __DEV__,
});

const portal = resolveApiUrl({ configured: process.env.EXPO_PUBLIC_SELLER_PORTAL_URL, hostUri: Constants.expoConfig?.hostUri, devPort: DEV_PORTAL_PORT, dev: __DEV__ });
export const portalUrl: string | null = portal.ok ? portal.url : null;

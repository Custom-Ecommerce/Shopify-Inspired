import type { QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { createMobileRuntime, type MobileApp, type MobileRuntime } from '../core/runtime';
import { phoneStore } from './async-storage';
import { secureSecretStore } from './secure-store';

/** The runtime of an app on a phone. */
export function createPhoneRuntime(input: { app: MobileApp; baseUrl: string; appVersion: string; queryClient: QueryClient }): MobileRuntime {
  return createMobileRuntime({
    app: input.app,
    baseUrl: input.baseUrl,
    appVersion: input.appVersion,
    secrets: secureSecretStore,
    storage: phoneStore,
    random: () => Crypto.randomUUID(),
    onCacheClear: () => input.queryClient.clear(),
    onSent: () => {
      void input.queryClient.invalidateQueries();
    },
  });
}

import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from '../core/storage';

/** The refresh token, encrypted with a key in the Android Keystore. */
export const secureSecretStore: SecretStore = {
  async get(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // The value can no longer be decrypted (a restored backup, a changed keystore): it is useless, so the user signs in again.
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      return null;
    }
  },
  async set(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key) {
    await SecureStore.deleteItemAsync(key);
  },
};

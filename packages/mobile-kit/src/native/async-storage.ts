import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '../core/storage';

/** The app's private storage: the cached screens and the queued changes. Never a token. */
export const phoneStore: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: async (key, value) => {
    await AsyncStorage.setItem(key, value);
  },
  remove: async (key) => {
    await AsyncStorage.removeItem(key);
  },
  keys: async () => [...(await AsyncStorage.getAllKeys())],
};

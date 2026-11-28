/* The native modules the app touches, replaced for jest. No phone and no network. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest.mock factory cannot use an import
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => undefined) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));

// The apps are Android only (D-123), so the kit is tested with the Android preset. No phone and no emulator.
const preset = require('jest-expo/android/jest-preset');

const [first, ...rest] = preset.transformIgnorePatterns;

module.exports = {
  preset: 'jest-expo/android',
  // The first render compiles React Native: slow on a cold CI machine.
  testTimeout: 20_000,
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
  // FlashList and lucide (the icons) ship ES modules: they have to be transformed like React Native itself, lucide's .mjs files included.
  transformIgnorePatterns: [first.replace('(?!(.pnpm|', '(?!(.pnpm|@shopify/flash-list|lucide-react-native|'), ...rest],
  transform: { ...preset.transform, '\\.mjs$': preset.transform['\\.[jt]sx?$'] },
};

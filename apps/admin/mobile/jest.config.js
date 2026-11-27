// Android only (D-123). No phone and no emulator: the screen logic runs in jest.
const preset = require('jest-expo/android/jest-preset');

const [first, ...rest] = preset.transformIgnorePatterns;

module.exports = {
  preset: 'jest-expo/android',
  // The first render of a screen compiles it: slow on a cold CI machine.
  testTimeout: 20_000,
  setupFiles: ['<rootDir>/test/setup.ts', '@shopify/flash-list/jestSetup'],
  setupFilesAfterEnv: ['<rootDir>/test/setup-after.ts'],
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
  // FlashList ships ES modules: it has to be transformed like React Native itself.
  transformIgnorePatterns: [first.replace('(?!(.pnpm|', '(?!(.pnpm|@shopify/flash-list|'), ...rest],
};

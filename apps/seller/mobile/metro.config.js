// Expo's Metro config finds the pnpm workspace by itself: it watches the workspace root and resolves the packages' symlinked node_modules, so
// packages/mobile-kit, packages/contracts and packages/auth are bundled from source. No node-linker change is needed (see SETUP.md, mobile apps).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);

/**
 * @jest-environment node
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import appJson from '../app.json';
import easJson from '../eas.json';

// EP-32.US03.T04: what a release build must not contain, checked on the sources.

const root = join(__dirname, '..');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );

describe('release settings', () => {
  const files = [...sources(join(root, 'app')), ...sources(join(root, 'src')), ...sources(join(root, '..', '..', '..', 'packages', 'mobile-kit', 'src'))];

  it('writes nothing to the console, so no token or customer ends up in the phone log', () => {
    expect(files.length).toBeGreaterThan(20);
    // A call or an indexed access; a sentence that ends in "the console." is not one.
    expect(files.filter((file) => /\bconsole\s*(\.\s*(log|info|warn|error|debug|trace|dir|table)\b|\[)/.test(readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('keeps tokens out of ordinary storage', () => {
    const tokenWriters = files.filter((file) => /AsyncStorage\.setItem\([^)]*[Tt]oken/.test(readFileSync(file, 'utf8')));
    expect(tokenWriters).toEqual([]);
  });

  it('shrinks release builds, supports Android 8 and newer, and has no debug switches', () => {
    const plugin = (appJson.expo.plugins as unknown[]).find((entry): entry is [string, { android: Record<string, unknown> }] => Array.isArray(entry) && entry[0] === 'expo-build-properties');
    expect(plugin?.[1].android).toEqual({ minSdkVersion: 26, enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true });
    // The app only shows pictures from the web: it asks for no access to the phone's files.
    expect(appJson.expo.android.blockedPermissions).toEqual(['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']);
    const config = JSON.stringify(appJson) + JSON.stringify(easJson);
    for (const word of ['usesCleartextTraffic', 'developmentClient', 'debuggable']) expect(config).not.toContain(word);
    expect(easJson.build.production.android.buildType).toBe('app-bundle');
  });

  it('opens only its own screens from a link: no route list, and an unknown address goes to the start', () => {
    expect(appJson.expo.plugins).toContainEqual(['expo-router', { sitemap: false }]);
    const notFound = readFileSync(join(root, 'app', '+not-found.tsx'), 'utf8');
    expect(notFound).toContain('<Redirect href="/" />');
  });
});

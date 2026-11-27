/**
 * @jest-environment node
 */
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import appJson from '../app.json';
import easJson from '../eas.json';

const root = join(__dirname, '..');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );

describe('release settings', () => {
  it('writes nothing to the console', () => {
    const files = [...sources(join(root, 'app')), ...sources(join(root, 'src'))];
    expect(files.length).toBeGreaterThan(15);
    // A call or an indexed access; a sentence that ends in "the console." is not one.
    expect(files.filter((file) => /\bconsole\s*(\.\s*(log|info|warn|error|debug|trace|dir|table)\b|\[)/.test(readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('shrinks release builds, supports Android 8 and newer, asks for no file access and has no debug switches', () => {
    const plugin = (appJson.expo.plugins as unknown[]).find((entry): entry is [string, { android: Record<string, unknown> }] => Array.isArray(entry) && entry[0] === 'expo-build-properties');
    expect(plugin?.[1].android).toEqual({ minSdkVersion: 26, enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true });
    expect(appJson.expo.android.blockedPermissions).toEqual(['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']);
    expect(appJson.expo.android.allowBackup).toBe(false);
    const config = JSON.stringify(appJson) + JSON.stringify(easJson);
    for (const word of ['usesCleartextTraffic', 'developmentClient', 'debuggable']) expect(config).not.toContain(word);
  });

  it('opens only its own screens from a link: no route list, and an unknown address goes to the start', () => {
    expect(appJson.expo.plugins).toContainEqual(['expo-router', { sitemap: false }]);
    const notFound = readFileSync(join(root, 'app', '+not-found.tsx'), 'utf8');
    expect(notFound).toContain('<Redirect href="/" />');
  });
});

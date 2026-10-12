/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { getModule } from '@/core/modules/moduleRegistry';

/**
 * APP-070 — the native footprint of the optional iOS contact picker (ADR-0057).
 *
 * The package is in the binary, so the iOS usage string must be exact. The package's config plugin
 * adds BOTH Android Contacts permissions to the manifest, so both are blocked explicitly: Android
 * ships no Contacts permission at all. These tests fail if any of that is removed or changed.
 * (The generated manifest is checked separately, in a disposable prebuild; a merged APK is manual QA.)
 */
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const appJson = JSON.parse(read('app.json')) as { expo: Record<string, any> };
const PURPOSE = 'LifeSort bruger kun dine kontakter, når du vælger en person til en gave.';
const packageJson = JSON.parse(read('package.json'));

const resolved = (variant?: string) => {
  const previous = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = variant;
  try {
    jest.isolateModules(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const factory = require('../app.config.js') as (input: { config: unknown }) => { android: Record<string, any>; plugins: unknown[] };
    return factory({ config: JSON.parse(JSON.stringify(appJson.expo)) });
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = previous;
  }
};

describe('C1 the dependency', () => {
  it('expo-contacts is a dependency on the Expo SDK 57 range, and the only Contacts package', () => {
    expect(packageJson.dependencies['expo-contacts']).toMatch(/^~57\./);
    expect(Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).filter((name) => /contacts/i.test(name))).toEqual(['expo-contacts']);
  });

  it('the lockfile resolves it', () => {
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.packages['node_modules/expo-contacts'].version).toMatch(/^57\./);
    expect(lock.packages[''].dependencies['expo-contacts']).toBe(packageJson.dependencies['expo-contacts']);
  });
});

describe('C2 + C3 the config plugin and the iOS purpose string', () => {
  const entry = (plugins: unknown[]) => plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-contacts') as [string, { contactsPermission?: string }] | undefined;

  it('app.json declares the expo-contacts plugin with the approved Danish string', () => {
    const plugin = entry(appJson.expo.plugins);
    expect(plugin).toBeDefined();
    expect(plugin![1].contactsPermission).toBe(PURPOSE);
    expect(Object.keys(plugin![1])).toEqual(['contactsPermission']);
  });

  it('the string is factual: it says contacts are used only when the user picks a person for a gift, and promises nothing broader', () => {
    expect(PURPOSE).toMatch(/kun/);
    expect(PURPOSE).toMatch(/vælger en person/);
    expect(PURPOSE).not.toMatch(/Allow|tilgå alle|alle dine/i);
  });

  it.each([undefined, 'production'])('app.config.js (variant %s) keeps the plugin untouched', (variant) => {
    expect(entry(resolved(variant).plugins)![1].contactsPermission).toBe(PURPOSE);
  });
});

describe('C4 + C5 Android: no Contacts permission at all', () => {
  it('app.json blocks READ_CONTACTS and WRITE_CONTACTS', () => {
    const blocked: string[] = appJson.expo.android.blockedPermissions ?? [];
    expect(blocked).toContain('android.permission.READ_CONTACTS');
    expect(blocked).toContain('android.permission.WRITE_CONTACTS');
  });

  it.each([undefined, 'production'])('app.config.js (variant %s) still carries both blocks', (variant) => {
    const blocked: string[] = resolved(variant).android.blockedPermissions ?? [];
    expect(blocked).toEqual(expect.arrayContaining(['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS']));
  });

  it('the config declares no Contacts permission through any other door', () => {
    const { android } = appJson.expo;
    expect(JSON.stringify(android.permissions ?? [])).not.toMatch(/CONTACTS/);
    expect(JSON.stringify(appJson.expo.ios?.infoPlist ?? {})).not.toMatch(/Contacts/);
  });
});

describe('C6 Gifts is not activated by this story', () => {
  it('the module is still internal', () => {
    expect(getModule('gifts').availability).toBe('internal');
  });
});

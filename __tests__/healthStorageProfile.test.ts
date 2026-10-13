/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import * as SecureStore from 'expo-secure-store';

import { MODULE_REGISTRY, type ModuleDefinition } from '@/core/modules/moduleRegistry';
import {
  DATA_DOMAINS,
  PERSISTENCE_SURFACES,
  getDataDomain,
  localPlaintextPersistenceAllowedForSurface,
  localStorageProtectionForSurface,
} from '@/core/storage/dataProfileRegistry';

/**
 * APP-072 - health storage profile.
 *
 * 1. The binding rule for every health-sensitive module, today Cycle and Pregnancy (APP-076 Phase A): it must own at
 *    least one Profile B domain and every device surface carrying that domain must require encryption. Pregnancy's
 *    device surfaces are only PLANNED (no store, key or bytes exist), so they satisfy the rule only while the module is
 *    `internal`; promoting it beyond internal fails here until a surface is implemented.
 * 2. iOS device-backup posture: the encrypted Cycle store is relied on to stay out of iOS backup.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

type Domain = { id: string; module: string; profile: string };
type Surface = { id: string; location: string; containsDomains: readonly string[]; lifecycle?: 'implemented' | 'planned' };
type ProtectionOf = (surface: Surface) => { protection: string; plaintextAllowed: boolean };

/** Returns one message per violation; the real registry must return none. */
function healthStorageViolations(
  modules: Record<string, Pick<ModuleDefinition, 'sensitivity'> & Partial<Pick<ModuleDefinition, 'availability'>>>,
  domains: readonly Domain[],
  surfaces: readonly Surface[],
  protectionOf: ProtectionOf,
): string[] {
  const violations: string[] = [];
  for (const [moduleId, definition] of Object.entries(modules)) {
    if (!definition.sensitivity.includes('health')) continue;
    const profileB = domains.filter((domain) => domain.module === moduleId && domain.profile === 'B');
    if (profileB.length === 0) {
      violations.push(`${moduleId}: no Profile B logical domain`);
      continue;
    }
    for (const domain of profileB) {
      const local = surfaces.filter((surface) => surface.location === 'device' && surface.containsDomains.includes(domain.id));
      if (local.length === 0) violations.push(`${domain.id}: no local persistence surface registered`);
      // A planned surface is a contract, not bytes: it may stand in for a real store only while the module is internal.
      else if (local.every((surface) => surface.lifecycle === 'planned') && definition.availability !== 'internal') violations.push(`${domain.id}: only planned local surfaces, but ${moduleId} is not internal`);
      for (const surface of local) {
        const { protection, plaintextAllowed } = protectionOf(surface);
        if (protection !== 'encrypted-required' || plaintextAllowed) violations.push(`${surface.id}: carries ${domain.id} without requiring encryption`);
      }
    }
  }
  return violations;
}

const realProtection: ProtectionOf = (surface) => ({
  protection: localStorageProtectionForSurface(surface.id),
  plaintextAllowed: localPlaintextPersistenceAllowedForSurface(surface.id),
});

describe('APP-072 every health-sensitive module has a Profile B encrypted local contract', () => {
  const healthModules = Object.entries(MODULE_REGISTRY).filter(([, definition]) => definition.sensitivity.includes('health')).map(([id]) => id);

  it('is not vacuous: Cycle is a health module today', () => {
    expect(healthModules).toContain('cycle');
  });

  it('holds for the real registries', () => {
    expect(healthStorageViolations(MODULE_REGISTRY, DATA_DOMAINS, PERSISTENCE_SURFACES, realProtection)).toEqual([]);
  });

  it('classifies Cycle user health as Profile B on an encrypted-required physical surface, and reference content as D', () => {
    expect(getDataDomain('cycle.user-health')).toMatchObject({ profile: 'B', plaintextLocalPersistenceAllowed: false, encryptedLocalPersistenceRequired: true });
    expect(getDataDomain('cycle.reference-content')).toMatchObject({ profile: 'D' });
    expect(localStorageProtectionForSurface('async-storage:lifesort-cycle')).toBe('encrypted-required');
    expect(localPlaintextPersistenceAllowedForSurface('async-storage:lifesort-cycle')).toBe(false);
    expect(localStorageProtectionForSurface('secure-store:lifesort-cycle-health-key')).toBe('encrypted-required');
  });

  describe('the rule bites (synthetic registries, nothing is registered)', () => {
    const health = { pregnancy: { sensitivity: ['health'] as ModuleDefinition['sensitivity'] } };
    const encrypted: ProtectionOf = () => ({ protection: 'encrypted-required', plaintextAllowed: false });
    const device = (id: string, domain: string): Surface => ({ id, location: 'device', containsDomains: [domain] });

    it('fails a health module with no Profile B domain', () => {
      expect(healthStorageViolations(health, [{ id: 'pregnancy.log', module: 'pregnancy', profile: 'A' }], [device('s', 'pregnancy.log')], encrypted))
        .toEqual(['pregnancy: no Profile B logical domain']);
      expect(healthStorageViolations(health, [], [], encrypted)).toEqual(['pregnancy: no Profile B logical domain']);
    });

    it('fails a Profile B domain with no local surface', () => {
      expect(healthStorageViolations(health, [{ id: 'pregnancy.log', module: 'pregnancy', profile: 'B' }], [], encrypted))
        .toEqual(['pregnancy.log: no local persistence surface registered']);
    });

    it('fails a local surface that does not require encryption', () => {
      const plaintext: ProtectionOf = () => ({ protection: 'plaintext-allowed', plaintextAllowed: true });
      expect(healthStorageViolations(health, [{ id: 'pregnancy.log', module: 'pregnancy', profile: 'B' }], [device('async-storage:p', 'pregnancy.log')], plaintext))
        .toEqual(['async-storage:p: carries pregnancy.log without requiring encryption']);
    });

    it('lets a planned surface stand in only while the module is internal', () => {
      const planned = (id: string, domain: string): Surface => ({ ...device(id, domain), lifecycle: 'planned' });
      const domains = [{ id: 'pregnancy.log', module: 'pregnancy', profile: 'B' }];
      const internal = { pregnancy: { sensitivity: ['health'] as ModuleDefinition['sensitivity'], availability: 'internal' as const } };
      expect(healthStorageViolations(internal, domains, [planned('async-storage:p', 'pregnancy.log')], encrypted)).toEqual([]);
      for (const availability of ['hidden', 'beta', 'available', 'maintenance', 'retired'] as const) {
        expect(healthStorageViolations({ pregnancy: { ...internal.pregnancy, availability } }, domains, [planned('async-storage:p', 'pregnancy.log')], encrypted))
          .toEqual(['pregnancy.log: only planned local surfaces, but pregnancy is not internal']);
      }
      // A missing availability is treated strictly, and a planned surface still has to demand encryption.
      expect(healthStorageViolations(health, domains, [planned('async-storage:p', 'pregnancy.log')], encrypted)).toHaveLength(1);
      const plaintext: ProtectionOf = () => ({ protection: 'plaintext-allowed', plaintextAllowed: true });
      expect(healthStorageViolations(internal, domains, [planned('async-storage:p', 'pregnancy.log')], plaintext))
        .toEqual(['async-storage:p: carries pregnancy.log without requiring encryption']);
      // One implemented surface alongside a planned one is a real store.
      expect(healthStorageViolations({ pregnancy: { ...internal.pregnancy, availability: 'available' } }, domains, [planned('async-storage:p', 'pregnancy.log'), device('async-storage:q', 'pregnancy.log')], encrypted)).toEqual([]);
    });

    it('passes a complete contract', () => {
      expect(healthStorageViolations(health, [{ id: 'pregnancy.log', module: 'pregnancy', profile: 'B' }], [device('async-storage:p', 'pregnancy.log')], encrypted)).toEqual([]);
    });

    it('ignores modules that are not health-sensitive', () => {
      expect(healthStorageViolations({ food: { sensitivity: ['ordinary'] } }, [], [], encrypted)).toEqual([]);
    });
  });

  it('registers only the Phase A Pregnancy boundary, not a product store or route', () => {
    expect(MODULE_REGISTRY.pregnancy).toMatchObject({ availability: 'internal', sensitivity: ['health'], routeRoots: [] });
    expect(getDataDomain('pregnancy.user-health')).toMatchObject({ profile: 'B', plaintextLocalPersistenceAllowed: false });
    for (const id of ['async-storage:lifesort-pregnancy', 'secure-store:lifesort-pregnancy-health-key']) {
      expect(localStorageProtectionForSurface(id)).toBe('encrypted-required');
      expect(localPlaintextPersistenceAllowedForSurface(id)).toBe(false);
      expect(PERSISTENCE_SURFACES.find((surface) => surface.id === id)?.lifecycle).toBe('planned');
    }
    expect(fs.existsSync(path.join(REPO_ROOT, 'store', 'usePregnancyStore.ts'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'app', 'pregnancy'))).toBe(false);
  });
});

describe('APP-072 iOS device-backup posture', () => {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  const optedIn = (value: unknown) => value === false || value === 0 || (typeof value === 'string' && /^(false|no|0)$/i.test(value.trim()));

  function activeExpoConfigs(): Record<string, unknown>[] {
    const base = readJson('app.json').expo;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const build = require('../app.config.js') as (input: { config: unknown }) => Record<string, unknown>;
    const original = process.env.APP_VARIANT;
    try {
      return ['production', 'staging'].map((variant) => {
        process.env.APP_VARIANT = variant;
        return build({ config: structuredClone(base) });
      });
    } finally {
      if (original === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = original;
    }
  }

  it('no active Expo configuration opts AsyncStorage into iOS backup', () => {
    const configs = [readJson('app.json').expo as Record<string, unknown>, ...activeExpoConfigs()];
    for (const config of configs) {
      const plist = ((config.ios as { infoPlist?: Record<string, unknown> } | undefined)?.infoPlist ?? {});
      expect(optedIn('RCTAsyncStorageExcludeFromBackup' in plist ? plist.RCTAsyncStorageExcludeFromBackup : true)).toBe(false);
    }
  });

  it('the opt-in detector recognises every spelling of "do not exclude"', () => {
    for (const value of [false, 0, 'false', 'NO', ' 0 ']) expect(optedIn(value)).toBe(true);
    for (const value of [true, 1, 'true', undefined]) expect(optedIn(value)).toBe(false);
  });

  it('no config source mentions the key with a value that enables backup', () => {
    for (const file of ['app.json', 'app.config.js']) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(text).not.toMatch(/RCTAsyncStorageExcludeFromBackup['"]?\s*[:=]\s*(false|0|['"](false|no|0)['"])/i);
    }
  });

  it('pins the installed AsyncStorage default: excluded from backup unless the key says otherwise', () => {
    // A library default is relied on here. If this fails after a dependency upgrade, REVERIFY that the
    // iOS storage directory is still excluded from backup before changing the assertion (ADR-0023).
    const implementation = fs.readFileSync(path.join(REPO_ROOT, 'node_modules/@react-native-async-storage/async-storage/ios/RNCAsyncStorage.mm'), 'utf8');
    expect(implementation).toMatch(/objectForInfoDictionaryKey:@"RCTAsyncStorageExcludeFromBackup"/);
    expect(implementation).toMatch(/isExcludedFromBackup == nil\)\s*\{[^}]*isExcludedFromBackup = @YES/s);
    expect(implementation).toContain('NSURLIsExcludedFromBackupKey');
    expect(readJson('package.json').dependencies['@react-native-async-storage/async-storage']).toBe('2.2.0');
  });

  it('keeps the Cycle key device-bound (WHEN_UNLOCKED_THIS_DEVICE_ONLY) for every SecureStore call', async () => {
    jest.resetModules();
    const store = jest.requireMock('expo-secure-store') as typeof SecureStore;
    const adapter = jest.requireActual('@/core/storage/cycleHealthEncryptedStorage') as typeof import('@/core/storage/cycleHealthEncryptedStorage');
    const options = { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

    const payload = JSON.stringify({ state: { cycles: [], symptomLogs: [], avgCycleLength: 28, lutealPhaseLength: 14, reminderEnabled: false, reminderDaysBefore: 1, healthConditions: [], symptomGlossary: [] }, version: 0 });
    await adapter.clearCycleHealthEncryptionKey();
    await adapter.cycleHealthEncryptedStorage.setItem('lifesort-cycle', payload);
    await adapter.cycleHealthEncryptedStorage.getItem('lifesort-cycle');
    await adapter.clearCycleHealthEncryptionKey();

    const keyCalls = [store.getItemAsync, store.setItemAsync, store.deleteItemAsync].flatMap((fn) =>
      (fn as jest.Mock).mock.calls.filter((call) => call[0] === 'lifesort-cycle-health-key'),
    );
    expect(keyCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of keyCalls) expect(call[call.length - 1]).toEqual(options);
    expect(store.WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBeDefined();
  });
});

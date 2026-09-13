import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERSISTENCE_SURFACES } from '@/core/storage/dataProfileRegistry';
import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { definitionForSurface } from '@/core/storage/migrations/runtime';
import { createOutbox } from '@/core/sync/outbox';
import manifest from './fixtures/local-migrations/manifest.json';

const root = path.join(__dirname, 'fixtures/local-migrations');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('APP-038 fixture upgrades', () => {
  for (const fixture of manifest.filter((f) => !f.file.startsWith('cycle/'))) {
    it(`${fixture.file}: upgrades then reruns without a write`, async () => {
      let raw = read(fixture.file);
      const storage = { getItem: async () => raw, setItem: jest.fn(async (_key, value) => { raw = value; }) };
      const definition = definitionForSurface(fixture.storeId);
      expect(definition.detectVersion(JSON.parse(raw))).toBe(fixture.sourceVersion);
      await migrateLocalStore(definition, storage);
      expect(definition.validateCurrent(JSON.parse(raw))).toBe(true);
      expect(definition.detectVersion(JSON.parse(raw))).toBe(fixture.targetVersion);
      const current = raw; storage.setItem.mockClear();
      await migrateLocalStore(definition, storage);
      expect(raw).toBe(current); expect(storage.setItem).not.toHaveBeenCalled();
    });
  }
});

describe('APP-038 outbox compatibility', () => {
  it('preserves exact bytes and every ordered field through the production outbox reader', async () => {
    await AsyncStorage.clear();
    const raw = read('outbox/d417466-v1.json');
    await AsyncStorage.setItem('lifesort-outbox', raw);
    const write = jest.spyOn(AsyncStorage, 'setItem'); write.mockClear();
    const queue = await createOutbox('synthetic-account-a').list();
    expect(queue).toEqual(JSON.parse(raw).state.mutations);
    expect(queue.map((m) => [m.status, m.attempts, m.nextRetryAt])).toEqual([
      ['pending', 0, undefined], ['failed', 3, '2026-09-12T18:00:00.000Z'], ['failed', 6, undefined],
    ]);
    expect(await AsyncStorage.getItem('lifesort-outbox')).toBe(raw);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('APP-038 migration governance', () => {
  it('requires an explicit migration owner and policy for every device surface', () => {
    for (const surface of PERSISTENCE_SURFACES.filter((s) => s.location === 'device')) {
      expect(surface.migration).toBeDefined();
      expect(fs.existsSync(path.join(__dirname, '..', surface.migration!.owner))).toBe(true);
      expect(surface.migration!.reason.length).toBeGreaterThan(20);
    }
  });
  it('binds every versioned surface and version to an implementation and retained fixture', () => {
    for (const surface of PERSISTENCE_SURFACES.filter((s) => s.migration?.kind === 'versioned')) {
      const definition = definitionForSurface(surface.id);
      expect(definition.currentVersion).toBe(surface.migration!.currentVersion);
      expect(manifest.some((f) => f.storeId === surface.id && f.targetVersion === definition.currentVersion)).toBe(true);
    }
  });
  it('uses registered stores, existing git provenance and only synthetic raw fixture files', () => {
    for (const fixture of manifest) {
      const surface = PERSISTENCE_SURFACES.find((s) => s.id === fixture.storeId)!;
      expect(surface).toBeDefined(); expect(fixture.storeId).toBe(`async-storage:${fixture.storageKey}`);
      expect(fixture.synthetic).toBe(true); expect(fixture.sensitivity).toBeTruthy();
      expect(fixture.serialization).toBe('raw JSON bytes');
      expect(() => JSON.parse(read(fixture.file))).not.toThrow();
      const source = surface.evidence.find((file) => file.startsWith('store/')) ?? surface.evidence[0];
      expect(execFileSync('git', ['show', `${fixture.sourceCommit}:${source}`], { encoding: 'utf8' })).toContain(fixture.storageKey);
    }
  });
  it('intercepts every persisted Zustand adapter and keeps fixtures out of production', () => {
    const dir = path.join(__dirname, '..', 'store');
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      if (text.includes('persist(')) {
        expect(text).toMatch(/createJSONStorage\(\(\) => migrationGatedStorage\(/);
        const key = text.match(/name:\s*['"](lifesort-[^'"]+)['"]/)![1];
        const persistOptions = text.slice(text.indexOf(key));
        const version = Number(persistOptions.match(/version:\s*(\d+)/)?.[1] ?? 0);
        const policy = PERSISTENCE_SURFACES.find((s) => s.id === `async-storage:${key}`)!.migration!;
        expect(policy.currentVersion).toBe(version);
      }
    }
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'core/storage/migrations'))) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'core/storage/migrations', file), 'utf8');
      expect(source).not.toMatch(/fixtures\/|fetch\(|NetInfo|\.rpc\(|\.from\(|Date\.now|Math\.random|newEntityId/);
    }
  });
});

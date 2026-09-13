import fs from 'fs';
import path from 'path';
import { migrateLocalStore, type LocalMigrationDefinition } from '@/core/storage/migrations/harness';
import { homeLayoutMigration } from '@/core/storage/migrations/homeLayout';

const raw = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/home-layout/c4715e6-v0.json'), 'utf8');
function memory(initial = raw) {
  let bytes = initial;
  return {
    getItem: jest.fn(async () => bytes),
    setItem: jest.fn(async (_key: string, value: string) => { bytes = value; }),
    removeItem: jest.fn(),
    bytes: () => bytes,
  };
}
const run = (storage: ReturnType<typeof memory>, changes: Partial<LocalMigrationDefinition> = {}) =>
  migrateLocalStore({ ...homeLayoutMigration, ...changes }, storage);

describe('APP-038 core harness', () => {
  it('treats absence as absence without writing', async () => {
    const storage = { getItem: jest.fn(async () => null), setItem: jest.fn() };
    expect(await migrateLocalStore(homeLayoutMigration, storage)).toEqual({ raw: null, migrated: false });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('upgrades the original Home layout in one write, preserving choices and timestamps', async () => {
    const storage = memory();
    expect((await run(storage)).migrated).toBe(true);
    expect(JSON.parse(storage.bytes())).toEqual({ version: 1, state: { ...JSON.parse(raw).state, detail: {} } });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it('is deterministic and a second run is byte-preserving with no steps or writes', async () => {
    const first = memory(); const second = memory();
    await run(first); await run(second);
    expect(first.bytes()).toBe(second.bytes());
    first.setItem.mockClear();
    const step = jest.fn();
    expect((await run(first, { steps: { 0: step } })).migrated).toBe(false);
    expect(step).not.toHaveBeenCalled(); expect(first.setItem).not.toHaveBeenCalled();
  });
  it('recognizes the known Home state without a version but refuses arbitrary JSON', async () => {
    const storage = memory(JSON.stringify({ state: JSON.parse(raw).state }));
    await run(storage); expect(JSON.parse(storage.bytes()).version).toBe(1);
    await expect(run(memory('{"state":{"anything":true}}'))).rejects.toMatchObject({ code: 'unknown-legacy-shape' });
  });
  // Protocol probes are deliberately not claimed as historical release fixtures.
  it.each([0, 1, 2, 3])('executes every sequential step from protocol version %i', async (start) => {
    const storage = memory(JSON.stringify({ version: start, visits: [] }));
    const visited: number[] = [];
    const steps = Object.fromEntries([0, 1, 2].map((v) => [v, (value: any) => {
      expect(storage.setItem).not.toHaveBeenCalled(); visited.push(v);
      return { version: v + 1, visits: [...value.visits, v] };
    }]));
    await run(storage, { currentVersion: 3, detectVersion: (v: any) => v.version, steps, validateCurrent: (v: any) => v.version === 3 });
    expect(visited).toEqual([0, 1, 2].filter((v) => v >= start));
    expect(storage.setItem).toHaveBeenCalledTimes(start === 3 ? 0 : 1);
  });
});

describe('APP-038 rollback and failure injection', () => {
  it.each([
    ['transform-failed', { steps: { 0: () => { throw new Error('private data'); } } }],
    ['validation-failed', { validateCurrent: (): boolean => false }],
    ['validation-failed', { validateCurrent: (): boolean => { throw new Error('private data'); } }],
    ['serialization-failed', { serialize: (): string => { throw new Error('private data'); } }],
    ['serialization-failed', { serialize: (): string => '{"version":1}' }],
    ['missing-migration-step', { steps: {} }],
    ['validation-failed', { steps: { 0: () => ({ version: 8 }) } }],
  ] as const)('preserves raw bytes for %s', async (code, changes) => {
    const storage = memory();
    await expect(run(storage, changes)).rejects.toMatchObject({ code });
    expect(storage.bytes()).toBe(raw); expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    try { await run(storage, changes); } catch (error) { expect(String(error)).not.toContain('private data'); }
  });
  it('catches JSON serialization failure for a circular candidate without committing', async () => {
    const storage = memory();
    await expect(run(storage, {
      steps: { 0: () => { const value: any = { version: 1 }; value.self = value; return value; } },
      validateCurrent: () => true,
    })).rejects.toMatchObject({ code: 'serialization-failed' });
    expect(storage.bytes()).toBe(raw); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('does not persist earlier steps when a later step is missing', async () => {
    const storage = memory();
    await expect(run(storage, { currentVersion: 2 })).rejects.toMatchObject({ code: 'missing-migration-step' });
    expect(storage.bytes()).toBe(raw); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('preserves a failed final write and retries successfully on restart', async () => {
    const storage = memory(); storage.setItem.mockRejectedValueOnce(new Error('disk failure with private data'));
    await expect(run(storage)).rejects.toMatchObject({ code: 'write-failed' });
    expect(storage.bytes()).toBe(raw); expect(storage.removeItem).not.toHaveBeenCalled();
    expect((await run(storage)).migrated).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });
  it('fails closed on storage read failure', async () => {
    const storage = memory(); storage.getItem.mockRejectedValueOnce(new Error('private data'));
    await expect(run(storage)).rejects.toMatchObject({ code: 'read-failed' });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each([
    ['{secret', 'invalid-json'], ['{}', 'unknown-legacy-shape'],
    ['{"version":"0"}', 'unsupported-version'], ['{"version":-1}', 'unsupported-version'],
    ['{"version":0.5}', 'unsupported-version'], ['{"version":null}', 'unsupported-version'], ['{"version":99}', 'unsupported-newer-version'],
    ['{"version":1,"state":{}}', 'validation-failed'],
  ])('refuses malformed or future input %s', async (bytes, code) => {
    const storage = memory(bytes);
    await expect(run(storage)).rejects.toMatchObject({ code });
    expect(storage.bytes()).toBe(bytes); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('migrates keys independently, leaving an unrelated key intact', async () => {
    const bytes = new Map([['lifesort-home-layout', raw], ['unrelated', 'keep']]);
    await migrateLocalStore(homeLayoutMigration, {
      getItem: async (key) => bytes.get(key) ?? null,
      setItem: async (key, value) => { bytes.set(key, value); },
    });
    expect(bytes.get('unrelated')).toBe('keep');
  });
});

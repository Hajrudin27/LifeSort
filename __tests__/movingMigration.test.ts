import fs from 'fs';
import path from 'path';

import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { householdMigration } from '@/core/storage/migrations/household';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/household', name), 'utf8');
const memory = (raw: string) => {
  let current = raw;
  return {
    getItem: jest.fn(async () => current),
    setItem: jest.fn(async (_key: string, next: string) => { current = next; }),
    raw: () => current,
  };
};
const z1 = (movingItems: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, state: { tasks: [], taskSync: {}, shoppingItems: [], movingItems, ...extra },
});
const migrate = async (raw: string) => {
  const storage = memory(raw);
  await migrateLocalStore(householdMigration, storage);
  const envelope = JSON.parse(storage.raw());
  return { storage, version: envelope.version, state: envelope.state };
};
const ref = (itemId: string) => ({ templateId: 'moving-home', templateVersion: 1, templateItemId: itemId });

describe('APP-062 Household Z1 to Z2', () => {
  it('upgrades the db72a8c fixture: provenance only for the fixed seed ids, everything else byte-for-byte', async () => {
    const original = JSON.parse(fixture('db72a8c-v1.json'));
    const { storage, state, version } = await migrate(fixture('db72a8c-v1.json'));
    expect(version).toBe(2);
    expect(state.movingTemplate).toEqual({ id: 'moving-home', version: 1 });
    expect(state.movingItems).toEqual([
      { id: 'default-addressChange', label: 'Synthetic address change', checked: true, templateRef: ref('addressChange') },
      { id: 'default-internet', label: 'Synthetic internet', checked: false, templateRef: ref('internet') },
      { id: 'default-foo', label: 'Synthetic look-alike', checked: true },
      { id: '22222222-2222-4222-8222-222222222222', label: 'Synthetic custom item', checked: false },
    ]);
    // APP-061 content is untouched.
    expect(state.tasks).toEqual(original.state.tasks);
    expect(state.taskSync).toEqual(original.state.taskSync);
    expect(state.shoppingItems).toEqual(original.state.shoppingItems);
    // Idempotent: a second run reads current data and writes nothing.
    storage.setItem.mockClear();
    await migrateLocalStore(householdMigration, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('maps each of the five historical seed ids to its own template item', async () => {
    const seeds = ['addressChange', 'internet', 'electricity', 'mailForwarding', 'insurance'];
    const { state } = await migrate(z1(seeds.map((key) => ({ id: `default-${key}`, label: `Edited ${key}`, checked: key === 'internet' }))));
    expect(state.movingItems).toEqual(seeds.map((key) => ({
      id: `default-${key}`, label: `Edited ${key}`, checked: key === 'internet', templateRef: ref(key),
    })));
  });

  it('never infers provenance from labels, similar ids or case', async () => {
    const rows = [
      { id: 'default-foo', label: 'Change address', checked: false },
      { id: 'default-addresschange', label: 'x', checked: false },
      { id: 'Default-addressChange', label: 'y', checked: false },
      { id: 'default-addressChange-2', label: 'z', checked: false },
      { id: 'addressChange', label: 'Adresseændring', checked: true },
    ];
    const { state } = await migrate(z1(rows));
    expect(state.movingItems).toEqual(rows);
  });

  it('keeps an intentionally empty checklist empty and records the v1 marker', async () => {
    const { state } = await migrate(z1([]));
    expect(state.movingItems).toEqual([]);
    expect(state.movingTemplate).toEqual({ id: 'moving-home', version: 1 });
  });

  it('upgrades a Z0 envelope all the way through Z1 to Z2', async () => {
    const { state, version } = await migrate(fixture('9523a34-v0.json'));
    expect(version).toBe(2);
    expect(state.movingItems).toEqual([{ id: 'moving-1', label: 'Synthetic move', checked: true }]);
    expect(state.movingTemplate).toEqual({ id: 'moving-home', version: 1 });
  });

  it.each([
    ['a row without a label', [{ id: 'a', checked: false }]],
    ['a non-boolean checked flag', [{ id: 'a', label: 'x', checked: 'yes' }]],
    ['an empty id', [{ id: '', label: 'x', checked: false }]],
    ['an unknown extra field', [{ id: 'a', label: 'x', checked: false, address: 'Main St 1' }]],
    ['a stored provenance that could not exist before APP-062', [{ id: 'a', label: 'x', checked: false, templateRef: ref('internet') }]],
    ['duplicate ids', [{ id: 'a', label: 'x', checked: false }, { id: 'a', label: 'y', checked: true }]],
    ['a non-object row', ['text']],
    ['a non-array list', { a: 1 }],
  ])('fails closed on %s and preserves the original bytes', async (_label, movingItems) => {
    const raw = z1(movingItems);
    const storage = memory(raw);
    await expect(migrateLocalStore(householdMigration, storage)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(storage.raw()).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('fails closed on a future version', async () => {
    const raw = JSON.stringify({ version: 3, state: { tasks: [], taskSync: {}, shoppingItems: [], movingItems: [], movingTemplate: null } });
    const storage = memory(raw);
    await expect(migrateLocalStore(householdMigration, storage)).rejects.toMatchObject({ code: 'unsupported-newer-version' });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('APP-062 current Z2 validation', () => {
  const z2 = (movingItems: unknown, movingTemplate: unknown) => JSON.stringify({
    version: 2, state: { tasks: [], taskSync: {}, shoppingItems: [], movingItems, movingTemplate },
  });

  it.each([
    ['provenance with a null marker (the user dropped to none)', [{ id: 'a', label: 'x', checked: false, templateRef: ref('internet') }], null],
    ['an empty list with a marker', [], { id: 'moving-home', version: 1 }],
    ['an empty list without a marker', [], null],
    ['a custom row', [{ id: 'u', label: 'x', checked: true }], { id: 'moving-home', version: 1 }],
  ])('accepts %s unchanged', async (_label, items, marker) => {
    const raw = z2(items, marker);
    const storage = memory(raw);
    await migrateLocalStore(householdMigration, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ['a version below one', [{ id: 'a', label: 'x', checked: false, templateRef: { ...ref('internet'), templateVersion: 0 } }], null],
    ['a malformed item id', [{ id: 'a', label: 'x', checked: false, templateRef: { ...ref('internet'), templateItemId: 'Not Valid' } }], null],
    ['an extra provenance field', [{ id: 'a', label: 'x', checked: false, templateRef: { ...ref('internet'), address: 'x' } }], null],
    ['a partial provenance', [{ id: 'a', label: 'x', checked: false, templateRef: { templateId: 'moving-home' } }], null],
    ['a malformed marker', [], { id: 'moving-home', version: 1.5 }],
    ['a marker with an extra field', [], { id: 'moving-home', version: 1, address: 'x' }],
    ['a missing marker', [], undefined],
  ])('rejects %s', async (_label, items, marker) => {
    const storage = memory(z2(items, marker));
    await expect(migrateLocalStore(householdMigration, storage)).rejects.toMatchObject({ code: 'validation-failed' });
  });
});

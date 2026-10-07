import { householdMigration } from '@/core/storage/migrations/household';
import { migrateLocalStore } from '@/core/storage/migrations/harness';

const legacy = {
  state: {
    tasks: [{
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'maintenance',
      title: 'Boiler',
      frequency: 'yearly',
      lastDone: '2024-02-29',
      assignedTo: 'partner',
      rotates: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    }],
    shoppingItems: [{ id: 's', label: 'Milk', checked: true }],
    movingItems: [{ id: 'm', label: 'Internet', checked: false }],
  },
  version: 0,
};

const memory = (value: unknown) => {
  let raw = JSON.stringify(value);
  return {
    getItem: jest.fn(async () => raw),
    setItem: jest.fn(async (_key: string, next: string) => { raw = next; }),
    raw: () => raw,
  };
};

describe('APP-061 Household Z0 (chained through Z1 to the current Z2)', () => {
  it('preserves every legacy value and list while adding null timezone, sync cache and the v1 marker', async () => {
    const storage = memory(legacy);
    await migrateLocalStore(householdMigration, storage);
    const current = JSON.parse(storage.raw());
    expect(current).toEqual({
      version: 2,
      state: {
        ...legacy.state,
        tasks: [{ ...legacy.state.tasks[0], timeZone: null }],
        taskSync: {},
        movingTemplate: { id: 'moving-home', version: 1 },
      },
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('defaults pre-rotation tasks persisted without assignedTo/rotates instead of failing boot', async () => {
    const { assignedTo: _a, rotates: _r, ...preRotation } = legacy.state.tasks[0];
    const storage = memory({ ...legacy, state: { ...legacy.state, tasks: [preRotation] } });
    await migrateLocalStore(householdMigration, storage);
    expect(JSON.parse(storage.raw()).state.tasks).toEqual([
      { ...preRotation, assignedTo: 'me', rotates: false, timeZone: null },
    ]);
  });

  it('rejects a future version and preserves the original bytes', async () => {
    const storage = memory({ ...legacy, version: 3 });
    const before = storage.raw();
    await expect(migrateLocalStore(householdMigration, storage)).rejects.toMatchObject({ code: 'unsupported-newer-version' });
    expect(storage.raw()).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid current timezone', async () => {
    const storage = memory({
      version: 2,
      state: {
        ...legacy.state, tasks: [{ ...legacy.state.tasks[0], timeZone: 'Bad/Zone' }], taskSync: {},
        movingTemplate: { id: 'moving-home', version: 1 },
      },
    });
    await expect(migrateLocalStore(householdMigration, storage)).rejects.toMatchObject({ code: 'validation-failed' });
  });
});

import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

/**
 * APP-047 backup format 4: recipe ingredients follow the ingredient contract.
 * Formats 1–3 carried `{ name, amount }`, kept verbatim as legacy ingredients.
 */

let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
import { familyIngredient, unlinkedIngredient } from '@/core/food/ingredients';
import { useFoodStore } from '@/store/useFoodStore';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const backup = (version: number, data: Record<string, unknown>) => JSON.stringify({ version, exportedAt: '2026-09-01T00:00:00.000Z', data });
const recipe = (ingredients: unknown) => ({ id: 'r1', name: 'Synthetic soup', mealType: 'dinner', ingredients, tags: [] });
const food = (ingredients: unknown) => ({ food: { recipes: [recipe(ingredients)], selectedStores: ['Netto'] } });
const recipesOf = (result: ReturnType<typeof parseBackupFile>) => (result.ok ? result.data.food?.recipes : undefined);

describe('APP-047 backup parsing', () => {
  it('exports format 4', () => {
    expect(BACKUP_VERSION).toBe(4);
  });

  it.each([1, 2, 3])('format %i: keeps each { name, amount } verbatim as legacy, inferring no family', (version) => {
    const result = parseBackupFile(backup(version, food([{ name: 'Æg', amount: '3 stk' }, { name: 'Salt', amount: '' }])));
    expect(recipesOf(result)).toEqual([recipe([{ kind: 'legacy', name: 'Æg', amount: '3 stk' }, { kind: 'legacy', name: 'Salt', amount: '' }])]);
    expect(result.ok && result.data.food?.selectedStores).toEqual(['Netto']);
  });

  it('format 4: accepts the current contract unchanged', () => {
    const ingredients = [familyIngredient('egg', 'Æg', 3, 'piece'), unlinkedIngredient('Synthetic stock', 1.5, 'ml'), { kind: 'legacy', name: 'Salt', amount: '' }];
    expect(recipesOf(parseBackupFile(backup(4, food(ingredients))))).toEqual([recipe(ingredients)]);
  });

  it('format 3: keeps a recipe an older build cached from a newer one, when it meets the current contract', () => {
    const cached = [familyIngredient('egg', 'Æg', 3, 'piece'), { name: 'Salt', amount: '' }];
    expect(recipesOf(parseBackupFile(backup(3, food(cached))))).toEqual([recipe([cached[0], { kind: 'legacy', name: 'Salt', amount: '' }])]);
  });

  it.each([
    ['format 3 invalid new-shape ingredient', 3, [{ kind: 'family', familyId: 'egg-large', name: 'Æg', quantity: 3, unit: 'piece' }]],
    ['format 3 number amount', 3, [{ name: 'Æg', amount: 3 }]],
    ['format 3 extra key', 3, [{ name: 'Æg', amount: '3 stk', familyId: 'egg' }]],
    // Format 4 is canonical: the old shape is not normalized there.
    ['format 4 pre-APP-047 ingredient', 4, [{ name: 'Æg', amount: '3 stk' }]],
    ['format 4 unknown family', 4, [{ kind: 'family', familyId: 'egg-large', name: 'Æg', quantity: 3, unit: 'piece' }]],
    ['format 4 display unit', 4, [{ kind: 'unlinked', name: 'Salt', quantity: 1, unit: 'tsk' }]],
    ['format 4 zero quantity', 4, [{ kind: 'unlinked', name: 'Salt', quantity: 0, unit: 'g' }]],
    ['ingredients that are not a list', 4, { name: 'Æg' }],
  ])('rejects %s', (_name, version, ingredients) => {
    expect(parseBackupFile(backup(version as number, food(ingredients)))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('rejects a recipe that is not an object, and format 5', () => {
    expect(parseBackupFile(backup(4, { food: { recipes: ['seed-1'] } }))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(backup(5, food([])))).toEqual({ ok: false, error: 'unsupported_version' });
  });

  it('never reports ingredient text', () => {
    expect(JSON.stringify(parseBackupFile(backup(4, food([{ name: 'Synthetic secret', amount: '3 stk' }]))))).not.toContain('Synthetic secret');
  });
});

describe('APP-047 backup restore and export through the real Food store', () => {
  beforeEach(async () => {
    await useFoodStore.persist.rehydrate();
  });

  it('restores a format 3 recipe as typed legacy data, and a format 4 re-export round-trips', async () => {
    mockFileContent = backup(3, food([{ name: 'Æg', amount: '2 stk' }]));
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useFoodStore.getState().recipes).toEqual([recipe([{ kind: 'legacy', name: 'Æg', amount: '2 stk' }])]);

    const created = { id: 'r2', name: 'Synthetic new', mealType: 'lunch' as const, tags: [], ingredients: [unlinkedIngredient('Synthetic stock', 1.5, 'ml')] };
    useFoodStore.setState({ recipes: [...useFoodStore.getState().recipes, created] });
    const restored = JSON.stringify(useFoodStore.getState().recipes);
    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(4);

    useFoodStore.setState({ recipes: [] });
    mockFileContent = mockWritten;
    expect(await importBackup()).toMatchObject({ success: true });
    expect(JSON.stringify(useFoodStore.getState().recipes)).toBe(restored);
  });
});

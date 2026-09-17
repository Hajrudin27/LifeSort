import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  clearDocumentCacheEncryptionKey,
  decryptDocumentMetadataPayload,
  documentMetadataEncryptedStorage,
  encryptDocumentMetadataPayload,
} from '@/core/storage/documentCacheStorage';
import {
  expensesMoneyMigration,
  incomeMoneyMigration,
  savingsGoalsMoneyMigration,
} from '@/core/storage/migrations/economyMoney';
import { migrateLocalStore, type LocalMigrationDefinition } from '@/core/storage/migrations/harness';
import { migrationGatedStorage, runLocalMigrations } from '@/core/storage/migrations/runtime';

/**
 * APP-040 local money migrations: v0 major-unit numbers → v1 DKK MinorUnits.
 * Fixtures are raw bytes from the historical writers (see manifest.json).
 */

type Json = Record<string, any>;
const root = path.join(__dirname, 'fixtures/local-migrations');
const fixture = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const EXPENSES = 'lifesort-expenses';
const INCOME = 'lifesort-income-v2';
const SAVINGS = 'lifesort-savings-goals';

function memory(initial: string | null) {
  let bytes = initial;
  return {
    getItem: jest.fn(async () => bytes),
    setItem: jest.fn(async (_key: string, value: string) => { bytes = value; }),
    bytes: () => bytes,
  };
}
/** Replace listed fields so non-money content can be compared exactly. */
function withoutMoney(state: Json, lists: Record<string, string[]>, maps: string[] = [], scalars: string[] = []): Json {
  const copy: Json = { ...state };
  for (const [list, fields] of Object.entries(lists)) {
    copy[list] = state[list].map((item: Json) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, fields.includes(k) ? '<money>' : v])));
  }
  for (const map of maps) copy[map] = Object.fromEntries(Object.keys(state[map]).map((key) => [key, '<money>']));
  for (const scalar of scalars) copy[scalar] = '<money>';
  return copy;
}
const keyOrder = (value: unknown): unknown => JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : v));

describe('APP-040 v0 → v1 per store (historical fixtures)', () => {
  it('income: converts every month once, keeps explicit zero and absent months distinct', async () => {
    const raw = fixture('income/c73bf68-v0.json');
    const storage = memory(raw);
    expect((await migrateLocalStore(incomeMoneyMigration, storage)).migrated).toBe(true);
    const migrated = JSON.parse(storage.bytes()!);
    expect(migrated).toEqual({
      state: { incomeByMonth: { '2026-07': 3_200_000, '2026-08': 0, '2026-09': 3_215_050, '2026-10': 330 } },
      version: 1,
    });
    expect(Object.keys(migrated.state.incomeByMonth)).toEqual(Object.keys(JSON.parse(raw).state.incomeByMonth));
    expect('2026-06' in migrated.state.incomeByMonth).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('savings: converts goals, signed history and extra savings; everything else is identical', async () => {
    const raw = fixture('savings-goals/c73bf68-v0.json');
    const before = JSON.parse(raw);
    const storage = memory(raw);
    await migrateLocalStore(savingsGoalsMoneyMigration, storage);
    const after = JSON.parse(storage.bytes()!);
    expect(after.version).toBe(1);
    expect(after.state.goals.map((g: Json) => [g.id, g.targetAmount, g.savedAmount])).toEqual([
      ['7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928', 2_000_000, 150_030],
      ['1725206400000', 100_000, 30],
      ['2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', 899_999, 0],
    ]);
    expect(after.state.history.map((h: Json) => [h.id, h.amount])).toEqual([
      ['1725206400001', 10], ['1725206400002', 20],
      ['a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 200_000], ['b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', -49_970],
    ]);
    expect(after.state.extraSavings).toBe(25_075);
    const lists = { goals: ['targetAmount', 'savedAmount'], history: ['amount'] };
    expect(withoutMoney(after.state, lists, [], ['extraSavings'])).toEqual(withoutMoney(before.state, lists, [], ['extraSavings']));
    expect(keyOrder(after)).toBe(keyOrder(before));
  });

  it('expenses (c73bf68 inner payload): converts amounts and budgets once, preserving IDs, attachments, order and metadata', async () => {
    const raw = fixture('expenses/c73bf68-inner-v0.json');
    const before = JSON.parse(raw);
    const storage = memory(raw);
    await migrateLocalStore(expensesMoneyMigration, storage);
    const after = JSON.parse(storage.bytes()!);
    expect(after.state.expenses.map((e: Json) => [e.id, e.amount])).toEqual([
      ['9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', 825_000], ['1725206400000', 1_234],
      ['5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d', 19_995], ['3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a', 0],
    ]);
    expect(after.state.categoryBudgets).toEqual({ bill: 900_000, shopping: 150_050 });
    const shape = (state: Json) => withoutMoney(state, { expenses: ['amount'] }, ['categoryBudgets']);
    expect(shape(after.state)).toEqual(shape(before.state));
    expect(keyOrder(after)).toBe(keyOrder(before));
  });

  it('expenses (49c4355 plaintext shape, before attachments existed): signs and recurrence metadata survive', async () => {
    const raw = fixture('expenses/49c4355-plaintext-v0.json');
    const storage = memory(raw);
    await migrateLocalStore(expensesMoneyMigration, storage);
    const after = JSON.parse(storage.bytes()!);
    expect(after.state.expenses.map((e: Json) => e.amount)).toEqual([650_000, 650_000, 3_250, 30, -2_575]);
    expect(after.state.categoryBudgets).toEqual({ bill: 700_000, food: 123_456 });
    expect(after.state.seriesStoppedAt).toEqual({ '1725206400000': '2024-12' });
    expect(after.state.expenses.every((e: Json) => !('attachments' in e))).toBe(true);
  });

  it.each([
    ['income', incomeMoneyMigration, 'income/c73bf68-v0.json'],
    ['savings', savingsGoalsMoneyMigration, 'savings-goals/c73bf68-v0.json'],
    ['expenses', expensesMoneyMigration, 'expenses/c73bf68-inner-v0.json'],
  ] as const)('%s: a migrated v1 store is never scaled again', async (_name, definition, file) => {
    const storage = memory(fixture(file));
    await migrateLocalStore(definition, storage);
    const current = storage.bytes();
    storage.setItem.mockClear();
    for (let i = 0; i < 3; i += 1) {
      expect(await migrateLocalStore(definition, storage)).toEqual({ raw: current, migrated: false });
    }
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.bytes()).toBe(current);
  });
});

describe('APP-040 migration failure preserves the original bytes', () => {
  const cases: [string, LocalMigrationDefinition, string, string][] = [
    ['third decimal in income', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': 12.345 } }, version: 0 }), 'transform-failed'],
    ['unsafe scaled income', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': 1e14 } }, version: 0 }), 'transform-failed'],
    ['JSON null (a former NaN) in savings', savingsGoalsMoneyMigration, JSON.stringify({ state: { goals: [], history: [], extraSavings: null }, version: 0 }), 'transform-failed'],
    ['one bad history row among good ones', savingsGoalsMoneyMigration, JSON.stringify({ state: { goals: [{ id: 'g', targetAmount: 10, savedAmount: 1 }], history: [{ id: 'h1', amount: 1 }, { id: 'h2', amount: 0.001 }], extraSavings: 0 }, version: 0 }), 'transform-failed'],
    ['third decimal in an expense budget', expensesMoneyMigration, JSON.stringify({ state: { expenses: [{ id: 'e', amount: 10 }], seriesStoppedAt: {}, categoryBudgets: { food: 99.999 } }, version: 0 }), 'transform-failed'],
    ['missing amount', expensesMoneyMigration, JSON.stringify({ state: { expenses: [{ id: 'e' }], seriesStoppedAt: {}, categoryBudgets: {} }, version: 0 }), 'transform-failed'],
    ['unknown state key', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: {}, extra: 1 }, version: 0 }), 'transform-failed'],
    ['versionless payload', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': 1 } } }), 'unknown-legacy-shape'],
    ['future version', savingsGoalsMoneyMigration, JSON.stringify({ state: { goals: [], history: [], extraSavings: 0 }, version: 2 }), 'unsupported-newer-version'],
    ['v1 with a fractional minor unit', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': 12.5 } }, version: 1 }), 'validation-failed'],
    ['v1 with an unsafe integer', expensesMoneyMigration, JSON.stringify({ state: { expenses: [{ id: 'e', amount: 2 ** 60 }], seriesStoppedAt: {}, categoryBudgets: {} }, version: 1 }), 'validation-failed'],
    // Safe integers that are valid MinorUnits but cannot round-trip the server transport or display exactly.
    ['v1 income with MAX_SAFE_INTEGER', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': Number.MAX_SAFE_INTEGER } }, version: 1 }), 'validation-failed'],
    ['v1 savings history just above 2^33 DKK', savingsGoalsMoneyMigration, JSON.stringify({ state: { goals: [], history: [{ id: 'h', amount: 2 ** 33 * 100 + 1 }], extraSavings: 0 }, version: 1 }), 'validation-failed'],
    ['v1 expense budget just above 2^33 DKK', expensesMoneyMigration, JSON.stringify({ state: { expenses: [], seriesStoppedAt: {}, categoryBudgets: { food: -(2 ** 33 * 100 + 1) } }, version: 1 }), 'validation-failed'],
    ['v1 exact cent that a sub-cent value aliases', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': 2_000_000_000_000_000 } }, version: 1 }), 'validation-failed'],
    ['v0 legacy value that converts to unsupported money', incomeMoneyMigration, JSON.stringify({ state: { incomeByMonth: { '2026-09': 8589934592.01 } }, version: 0 }), 'transform-failed'],
    // The raw bytes an old writer produced for parseFloat("20000000000000.001"): identical to the cent's.
    ['v0 parseFloat-collapsed third decimal', incomeMoneyMigration, `{"state":{"incomeByMonth":{"2026-09":${parseFloat('20000000000000.001')}}},"version":0}`, 'transform-failed'],
    ['v0 high-magnitude third decimal', savingsGoalsMoneyMigration, JSON.stringify({ state: { goals: [], history: [], extraSavings: 5000000000.001 }, version: 0 }), 'transform-failed'],
  ];
  it.each(cases)('%s → %s, no write', async (_name, definition, raw, code) => {
    const storage = memory(raw);
    await expect(migrateLocalStore(definition, storage)).rejects.toMatchObject({ code });
    expect(storage.bytes()).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    try { await migrateLocalStore(definition, storage); } catch (error) {
      expect(String(error)).not.toMatch(/12\.345|99\.999|0\.001|1e\+?14/);
    }
  });
});

describe('APP-040 per-store partial upgrade and restart safety (APP-038 runtime)', () => {
  const incomeV0 = fixture('income/c73bf68-v0.json');
  const savingsV0 = fixture('savings-goals/c73bf68-v0.json');
  const migratedBytes = async (definition: LocalMigrationDefinition, raw: string) => {
    const storage = memory(raw);
    await migrateLocalStore(definition, storage);
    return storage.bytes()!;
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('Income v0 + Savings v0 (Expenses already v1): one boot pass migrates both once', async () => {
    await AsyncStorage.multiSet([[INCOME, incomeV0], [SAVINGS, savingsV0]]);
    await runLocalMigrations();
    expect(await AsyncStorage.getItem(INCOME)).toBe(await migratedBytes(incomeMoneyMigration, incomeV0));
    expect(await AsyncStorage.getItem(SAVINGS)).toBe(await migratedBytes(savingsGoalsMoneyMigration, savingsV0));
  });

  it('Income v1 + Savings v0: a restart migrates only Savings and leaves Income byte-identical', async () => {
    const incomeV1 = await migratedBytes(incomeMoneyMigration, incomeV0);
    await AsyncStorage.multiSet([[INCOME, incomeV1], [SAVINGS, savingsV0]]);
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    await runLocalMigrations();
    expect(await AsyncStorage.getItem(INCOME)).toBe(incomeV1);
    expect(writes.mock.calls.map(([key]) => key)).toEqual([SAVINGS]);
    writes.mockClear();
    await runLocalMigrations();
    expect(writes).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(INCOME))!).state.incomeByMonth['2026-07']).toBe(3_200_000);
  });

  it('a current v1 store with an unsupported safe integer blocks boot and keeps its raw bytes', async () => {
    const unsupportedV1 = JSON.stringify({ state: { incomeByMonth: { '2026-09': 2 ** 33 * 100 + 1 } }, version: 1 });
    await AsyncStorage.setItem(INCOME, unsupportedV1);
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    await expect(runLocalMigrations()).rejects.toMatchObject({ storeId: `async-storage:${INCOME}`, code: 'validation-failed' });
    // The hydration-time read runs the same definition (runtime's versioned read path).
    await expect(migrateLocalStore(incomeMoneyMigration, AsyncStorage)).rejects.toMatchObject({ code: 'validation-failed' });
    expect(await AsyncStorage.getItem(INCOME)).toBe(unsupportedV1);
    expect(writes).not.toHaveBeenCalled();
  });

  it('a failing store blocks boot without undoing or rescaling the store that already committed', async () => {
    const badSavings = JSON.stringify({ state: { goals: [], history: [], extraSavings: 12.345 }, version: 0 });
    await AsyncStorage.multiSet([[INCOME, incomeV0], [SAVINGS, badSavings]]);
    await expect(runLocalMigrations()).rejects.toMatchObject({ storeId: `async-storage:${SAVINGS}`, code: 'transform-failed' });
    const incomeAfterFirstBoot = await AsyncStorage.getItem(INCOME);
    expect(JSON.parse(incomeAfterFirstBoot!).version).toBe(1);
    expect(await AsyncStorage.getItem(SAVINGS)).toBe(badSavings);
    // Next process: same result, no double scaling, original savings bytes kept.
    await expect(runLocalMigrations()).rejects.toMatchObject({ code: 'transform-failed' });
    expect(await AsyncStorage.getItem(INCOME)).toBe(incomeAfterFirstBoot);
    expect(await AsyncStorage.getItem(SAVINGS)).toBe(badSavings);
  });
});

describe('APP-040 encrypted Expenses: inner v0 → v1 through the secure adapter', () => {
  const innerV0 = fixture('expenses/c73bf68-inner-v0.json');
  const plaintextV0 = fixture('expenses/49c4355-plaintext-v0.json');

  beforeEach(async () => {
    await AsyncStorage.clear();
    await clearDocumentCacheEncryptionKey();
    jest.clearAllMocks();
  });

  async function storedInner(): Promise<Json> {
    const raw = (await AsyncStorage.getItem(EXPENSES))!;
    expect(raw).toContain('__lifesort_encrypted_document_metadata__');
    return JSON.parse(await decryptDocumentMetadataPayload(EXPENSES, raw));
  }

  it('upgrades an encrypted c73bf68 v0 payload in one encrypted commit with no plaintext staging', async () => {
    await AsyncStorage.setItem(EXPENSES, await encryptDocumentMetadataPayload(EXPENSES, innerV0));
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    const returned = JSON.parse((await documentMetadataEncryptedStorage.getItem(EXPENSES))!);

    expect(returned.version).toBe(1);
    expect(returned.state.expenses.map((e: Json) => e.amount)).toEqual([825_000, 1_234, 19_995, 0]);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toBe(EXPENSES);
    expect(await AsyncStorage.getAllKeys()).toEqual([EXPENSES]);
    const raw = (await AsyncStorage.getItem(EXPENSES))!;
    for (const plaintext of ['Synthetic rent', 'synthetic-receipt.jpg', '825000', '"amount"', 'categoryBudgets']) {
      expect(raw).not.toContain(plaintext);
    }
    expect(await storedInner()).toEqual(returned);
    expect(returned.state.expenses[1].attachments).toEqual(JSON.parse(innerV0).state.expenses[1].attachments);

    writes.mockClear();
    expect(JSON.parse((await documentMetadataEncryptedStorage.getItem(EXPENSES))!)).toEqual(returned);
    expect(writes).not.toHaveBeenCalled();
  });

  it('upgrades a pre-encryption plaintext v0 payload into a single encrypted v1 commit', async () => {
    await AsyncStorage.setItem(EXPENSES, plaintextV0);
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    const returned = JSON.parse((await documentMetadataEncryptedStorage.getItem(EXPENSES))!);
    expect(returned.version).toBe(1);
    expect(returned.state.expenses.map((e: Json) => e.amount)).toEqual([650_000, 650_000, 3_250, 30, -2_575]);
    // The money upgrade happens before the first encrypted commit. APP-029's existing
    // cleanup-record rewrite then re-encrypts the same v1 plaintext; no write is ever
    // plaintext, v0, or to another key.
    expect(writes.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const [key, value] of writes.mock.calls) {
      expect(key).toBe(EXPENSES);
      expect(value).toContain('__lifesort_encrypted_document_metadata__');
      expect(JSON.parse(await decryptDocumentMetadataPayload(EXPENSES, value)).version).toBe(1);
    }
    expect(await AsyncStorage.getAllKeys()).toEqual([EXPENSES]);
    expect(await AsyncStorage.getItem(EXPENSES)).not.toContain('Synthetic');
    expect(await storedInner()).toEqual(returned);
  });

  it('keeps the prior encrypted bytes and blocks ordinary writes when inner money is unsupported', async () => {
    const bad = JSON.stringify({ ...JSON.parse(innerV0), state: { ...JSON.parse(innerV0).state, categoryBudgets: { bill: 12.345 } } });
    const encrypted = await encryptDocumentMetadataPayload(EXPENSES, bad);
    await AsyncStorage.setItem(EXPENSES, encrypted);
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();

    await expect(documentMetadataEncryptedStorage.getItem(EXPENSES)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(await AsyncStorage.getItem(EXPENSES)).toBe(encrypted);
    expect(writes).not.toHaveBeenCalled();
    await expect(documentMetadataEncryptedStorage.setItem(EXPENSES, JSON.stringify({ state: {}, version: 1 })))
      .rejects.toMatchObject({ code: 'write-blocked-after-protected-failure' });
    expect(await AsyncStorage.getItem(EXPENSES)).toBe(encrypted);
  });

  it('keeps plaintext legacy bytes and creates no key when legacy money is unsupported', async () => {
    const bad = plaintextV0.replace('"amount":32.5', '"amount":32.505');
    await AsyncStorage.setItem(EXPENSES, bad);
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    await expect(documentMetadataEncryptedStorage.getItem(EXPENSES)).rejects.toMatchObject({ code: 'migration-failed' });
    expect(await AsyncStorage.getItem(EXPENSES)).toBe(bad);
    expect(writes).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('rejects an encrypted v1 payload holding a safe integer the app cannot support, keeping the encrypted bytes', async () => {
    const v1 = JSON.stringify({ state: { expenses: [{ id: 'e', amount: Number.MAX_SAFE_INTEGER }], seriesStoppedAt: {}, categoryBudgets: {} }, version: 1 });
    const encrypted = await encryptDocumentMetadataPayload(EXPENSES, v1);
    await AsyncStorage.setItem(EXPENSES, encrypted);
    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    await expect(documentMetadataEncryptedStorage.getItem(EXPENSES)).rejects.toMatchObject({ code: 'validation-failed' });
    expect(await AsyncStorage.getItem(EXPENSES)).toBe(encrypted);
    expect(writes).not.toHaveBeenCalled();
  });

  it('rejects an encrypted v1 payload holding a fractional minor unit without rescaling or rewriting it', async () => {
    const v1 = JSON.stringify({ state: { expenses: [{ id: 'e', amount: 1250.5 }], seriesStoppedAt: {}, categoryBudgets: {} }, version: 1 });
    const encrypted = await encryptDocumentMetadataPayload(EXPENSES, v1);
    await AsyncStorage.setItem(EXPENSES, encrypted);
    await expect(documentMetadataEncryptedStorage.getItem(EXPENSES)).rejects.toMatchObject({ code: 'validation-failed' });
    expect(await AsyncStorage.getItem(EXPENSES)).toBe(encrypted);
  });

  it('rejects a future inner version before any write, and the gated store surfaces only a fixed code', async () => {
    const future = JSON.stringify({ ...JSON.parse(innerV0), version: 2 });
    const encrypted = await encryptDocumentMetadataPayload(EXPENSES, future);
    await AsyncStorage.setItem(EXPENSES, encrypted);
    const error = await Promise.resolve(migrationGatedStorage(documentMetadataEncryptedStorage).getItem(EXPENSES))
      .then(() => null, (reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'read-failed' });
    expect(String(error)).not.toMatch(/Synthetic|825|12\.34/);
    expect(await AsyncStorage.getItem(EXPENSES)).toBe(encrypted);
  });

  it('with Expenses already v1 and Income still v0, neither store is rescaled across restarts', async () => {
    const v1Inner = JSON.parse((await (async () => {
      await AsyncStorage.setItem(EXPENSES, await encryptDocumentMetadataPayload(EXPENSES, innerV0));
      return documentMetadataEncryptedStorage.getItem(EXPENSES);
    })())!);
    await AsyncStorage.setItem(INCOME, fixture('income/c73bf68-v0.json'));
    for (let boot = 0; boot < 2; boot += 1) {
      await runLocalMigrations();
      expect(JSON.parse((await documentMetadataEncryptedStorage.getItem(EXPENSES))!)).toEqual(v1Inner);
      expect(JSON.parse((await AsyncStorage.getItem(INCOME))!).state.incomeByMonth['2026-09']).toBe(3_215_050);
    }
  });
});

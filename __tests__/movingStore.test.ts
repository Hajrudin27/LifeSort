import AsyncStorage from '@react-native-async-storage/async-storage';

import { MOVING_TEMPLATE_ID } from '@/core/home/moving';
import { withOutboxCleanup } from '@/core/sync/outbox';
import type { MovingTemplateDefinition } from '@/features/home/movingTemplates';
import i18n from '@/localization/i18n';
import type { MovingItem } from '@/types/household';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mockAccount: string | null = A;
/** undefined = the session follows the signed-in account; otherwise it is forced. */
let mockSessionUser: string | null | undefined;
let mockSessionGate: Promise<void> | null = null;
let mockMovingRows: unknown[] = [];
let mockCatalog: readonly MovingTemplateDefinition[] | null = null;
type Call = { table: string; op: 'upsert' | 'delete'; rows?: Record<string, unknown>[]; user?: unknown; id?: unknown };
const mockCalls: Call[] = [];

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockAccount ? { id: mockAccount } : null } }),
      getSession: async () => {
        if (mockSessionGate) await mockSessionGate;
        const id = mockSessionUser === undefined ? mockAccount : mockSessionUser;
        return { data: { session: id ? { user: { id }, access_token: 'token' } : null }, error: null };
      },
    },
    from: (table: string) => ({
      select: () => ({ eq: () => Promise.resolve({ data: table === 'household_moving_items' ? mockMovingRows : [], error: null }) }),
      upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        mockCalls.push({ table, op: 'upsert', rows: Array.isArray(rows) ? rows : [rows] });
        return Promise.resolve({ error: null });
      },
      delete: () => ({ eq: (_c1: string, user: unknown) => ({ eq: (_c2: string, id: unknown) => {
        mockCalls.push({ table, op: 'delete', user, id });
        return Promise.resolve({ error: null });
      } }) }),
    }),
  },
}));
// Test-only seam: prove upgrade semantics against a synthetic v2 without shipping one.
jest.mock('@/features/home/movingTemplates', () => {
  const actual = jest.requireActual('@/features/home/movingTemplates');
  return {
    ...actual,
    latestSelectableMovingTemplate: (id?: string, catalog?: unknown) =>
      actual.latestSelectableMovingTemplate(id, catalog ?? mockCatalog ?? undefined),
    availableMovingUpgrade: (marker: unknown, items: unknown, catalog?: unknown) =>
      actual.availableMovingUpgrade(marker, items, catalog ?? mockCatalog ?? undefined),
  };
});

import { useHouseholdStore } from '@/store/useHouseholdStore';

const store = () => useHouseholdStore.getState();
const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const movingCalls = () => mockCalls.filter((call) => call.table === 'household_moving_items');
const ref = (itemId: string, templateVersion = 1) => ({ templateId: MOVING_TEMPLATE_ID, templateVersion, templateItemId: itemId });
const reload = async () => { await settle(); await useHouseholdStore.persist.rehydrate(); };
/** What a restarted app would read: the bytes on disk, not the in-memory state. */
const persisted = async () => {
  await settle();
  const raw = await AsyncStorage.getItem('lifesort-household');
  return raw === null ? null : JSON.parse(raw) as { version: number; state: { movingItems: MovingItem[]; movingTemplate: unknown } };
};

function synthetic(version: number, ids: string[]): MovingTemplateDefinition {
  const real = jest.requireActual('@/features/home/movingTemplates').MOVING_TEMPLATE_CATALOG[0] as MovingTemplateDefinition;
  return {
    ...real, version,
    items: ids.map((id) => ({ id, labelKey: id, section: 'administration' as const })),
  };
}

beforeEach(async () => {
  mockAccount = A;
  mockSessionUser = undefined;
  mockSessionGate = null;
  mockMovingRows = [];
  mockCatalog = null;
  mockCalls.length = 0;
  await i18n.changeLanguage('en');
  await withOutboxCleanup(async () => { await AsyncStorage.clear(); });
  store().clearLocal();
  await useHouseholdStore.persist.rehydrate();
  store().clearLocal();
  mockCalls.length = 0;
});

describe('APP-062 no hydration-time seeding', () => {
  it('a fresh install hydrates to an empty checklist with no marker', async () => {
    await AsyncStorage.clear();
    await useHouseholdStore.persist.rehydrate();
    expect(store().movingItems).toEqual([]);
    expect(store().movingTemplate).toBeNull();
  });

  it('an intentionally empty checklist stays empty across restarts and keeps its marker', async () => {
    expect(store().startMovingFromTemplate()).toBe(5);
    for (const item of [...store().movingItems]) store().removeMovingItem(item.id);
    expect((await persisted())).toMatchObject({
      version: 2, state: { movingItems: [], movingTemplate: { id: MOVING_TEMPLATE_ID, version: 1 } },
    });
    await reload();
    expect(store().movingItems).toEqual([]);
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 1 });
    await reload();
    expect(store().movingItems).toEqual([]);
  });

  it('a deleted suggestion does not come back because of hydration', async () => {
    store().startMovingFromTemplate();
    const removed = store().movingItems.find((item) => item.templateRef?.templateItemId === 'internet')!;
    store().removeMovingItem(removed.id);
    const disk = await persisted();
    expect(disk!.state.movingItems).toHaveLength(4);
    expect(disk!.state.movingItems.some((item) => item.templateRef?.templateItemId === 'internet')).toBe(false);
    await reload();
    expect(store().movingItems).toHaveLength(4);
    expect(store().movingItems.some((item) => item.templateRef?.templateItemId === 'internet')).toBe(false);
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 1 });
  });

  it('persists items with provenance and the marker across a restart', async () => {
    store().startMovingFromTemplate();
    const before = store().movingItems;
    expect((await persisted())!.state.movingItems).toEqual(before);
    await reload();
    expect(store().movingItems).toEqual(before);
  });
});

describe('APP-062 explicit start', () => {
  it('copies the v1 suggestions as fresh user rows with provenance and the marker', () => {
    expect(store().startMovingFromTemplate()).toBe(5);
    const items = store().movingItems;
    expect(items.map((item) => item.templateRef?.templateItemId)).toEqual(
      ['addressChange', 'mailForwarding', 'insurance', 'internet', 'electricity']);
    for (const item of items) {
      expect(item.id).toMatch(UUID);
      expect(item.checked).toBe(false);
      expect(item.templateRef).toMatchObject({ templateId: MOVING_TEMPLATE_ID, templateVersion: 1 });
    }
    expect(items.map((item) => item.label)).toEqual(items.map((item) =>
      i18n.t(`household.movingDefaults.${item.templateRef!.templateItemId}`)));
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 1 });
  });

  it('localizes the copy at that moment and never relabels it later', async () => {
    await i18n.changeLanguage('da');
    store().startMovingFromTemplate();
    const labels = store().movingItems.map((item) => item.label);
    await i18n.changeLanguage('en');
    expect(store().movingItems.map((item) => item.label)).toEqual(labels);
    expect(labels).toContain('Adresseændring');
  });

  it('does nothing when a checklist is already running', () => {
    store().startMovingFromTemplate();
    const before = store().movingItems;
    expect(store().startMovingFromTemplate()).toBe(0);
    expect(store().movingItems).toBe(before);
  });

  it('starts again from an emptied checklist with entirely new ids', () => {
    store().startMovingFromTemplate();
    const first = store().movingItems.map((item) => item.id);
    for (const id of first) store().removeMovingItem(id);
    expect(store().startMovingFromTemplate()).toBe(5);
    expect(store().movingItems.map((item) => item.id).filter((id) => first.includes(id))).toEqual([]);
  });

  it('adds suggestions beside existing custom rows when nothing has been applied yet', () => {
    store().addMovingItem('Order boxes');
    const custom = store().movingItems[0];
    expect(store().startMovingFromTemplate()).toBe(5);
    expect(store().movingItems[0]).toBe(custom);
    expect(store().movingItems).toHaveLength(6);
  });

  it('supports check, uncheck, custom items and deletion on copied rows', () => {
    store().startMovingFromTemplate();
    const [first] = store().movingItems;
    store().toggleMovingItem(first.id);
    expect(store().movingItems[0].checked).toBe(true);
    store().toggleMovingItem(first.id);
    expect(store().movingItems[0].checked).toBe(false);
    store().addMovingItem('Order boxes');
    const custom = store().movingItems[5];
    expect(custom.templateRef).toBeUndefined();
    store().removeMovingItem(first.id);
    expect(store().movingItems.map((item) => item.id)).not.toContain(first.id);
    expect(store().movingItems.some((item) => item.id === custom.id)).toBe(true);
  });

  it('collects no address, location or personal field on any row', async () => {
    store().startMovingFromTemplate();
    store().addMovingItem('Order boxes');
    await settle();
    for (const item of store().movingItems) {
      expect(Object.keys(item).every((key) => ['id', 'label', 'checked', 'templateRef'].includes(key))).toBe(true);
    }
    for (const call of movingCalls()) {
      for (const row of call.rows ?? []) {
        expect(Object.keys(row).sort()).toEqual(['checked', 'id', 'label', 'template_id', 'template_item_id', 'template_version', 'user_id']);
      }
    }
  });
});

describe('APP-062 explicit upgrade (synthetic v1 {A,B,C} to v2 {A,B,C,E})', () => {
  const rows = (): MovingItem[] => [
    { id: 'a', label: 'A', checked: true, templateRef: ref('A') },
    { id: 'b', label: 'B', checked: false, templateRef: ref('B') },
    { id: 'd', label: 'D', checked: false },
  ];
  beforeEach(() => {
    mockCatalog = [synthetic(1, ['A', 'B', 'C']), synthetic(2, ['A', 'B', 'C', 'E'])];
    useHouseholdStore.setState({ movingItems: rows(), movingTemplate: { id: MOVING_TEMPLATE_ID, version: 1 } });
  });

  it('changes nothing on its own, including across a restart', async () => {
    const before = store().movingItems;
    await reload();
    expect(store().movingItems).toEqual(before);
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 1 });
  });

  it('accepting adds only E, keeps C deleted and every other row exactly as it was, then advances the marker', async () => {
    expect(store().acceptMovingTemplateUpgrade()).toBe(1);
    const items = store().movingItems;
    expect(items.slice(0, 3)).toEqual(rows());
    expect(items).toHaveLength(4);
    expect(items[3]).toMatchObject({ label: 'household.movingDefaults.E', checked: false, templateRef: ref('E', 2) });
    expect(items[3].id).toMatch(UUID);
    expect(items.some((item) => item.templateRef?.templateItemId === 'C')).toBe(false);
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 2 });
    expect((await persisted())).toMatchObject({ state: { movingItems: items, movingTemplate: { id: MOVING_TEMPLATE_ID, version: 2 } } });
    await reload();
    expect(store().movingItems).toEqual(items);
    expect(store().acceptMovingTemplateUpgrade()).toBe(0);
  });

  it('never adds a duplicate when the user already holds the new item', () => {
    useHouseholdStore.setState({ movingItems: [...rows(), { id: 'e', label: 'E', checked: true, templateRef: ref('E', 2) }] });
    expect(store().acceptMovingTemplateUpgrade()).toBe(0);
    expect(store().movingItems).toHaveLength(4);
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 1 });
  });

  it('starting again from an emptied list uses the latest selectable version', () => {
    useHouseholdStore.setState({ movingItems: [] });
    expect(store().startMovingFromTemplate()).toBe(4);
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 2 });
  });

  it('syncs only the newly added rows', async () => {
    store().acceptMovingTemplateUpgrade();
    await settle();
    expect(movingCalls()).toHaveLength(1);
    expect(movingCalls()[0].rows).toHaveLength(1);
    expect(movingCalls()[0].rows![0]).toMatchObject({ user_id: A, template_id: MOVING_TEMPLATE_ID, template_version: 2, template_item_id: 'E' });
  });
});

describe('APP-062 remote rows and the marker', () => {
  const remote = (id: string, itemId: string | null, version: number | null, templateId: string | null = itemId ? MOVING_TEMPLATE_ID : null) => ({
    id, label: id, checked: false, template_id: templateId, template_version: version, template_item_id: itemId,
  });

  it('advances the marker to the highest proven version and keeps valid provenance', async () => {
    mockMovingRows = [remote('r1', 'internet', 1), remote('r2', 'electricity', 2)];
    await store().fetchFromSupabase();
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 2 });
    expect(store().movingItems.map((item) => item.templateRef?.templateVersion)).toEqual([1, 2]);
  });

  it('never lowers the local marker', async () => {
    useHouseholdStore.setState({ movingTemplate: { id: MOVING_TEMPLATE_ID, version: 3 } });
    mockMovingRows = [remote('r1', 'internet', 1)];
    await store().fetchFromSupabase();
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 3 });
  });

  it('infers nothing from custom rows, labels or an unrelated template', async () => {
    mockMovingRows = [remote('Change address', null, null), remote('o', 'internet', 4, 'other-template')];
    await store().fetchFromSupabase();
    expect(store().movingTemplate).toBeNull();
    expect(store().movingItems).toHaveLength(2);
  });

  it('drops rows with partial or malformed provenance instead of guessing', async () => {
    mockMovingRows = [
      remote('p1', 'internet', null), remote('p2', null, 1, MOVING_TEMPLATE_ID), remote('p3', 'internet', 0),
      remote('p4', 'Not Valid', 1), remote('ok', null, null),
    ];
    await store().fetchFromSupabase();
    expect(store().movingItems.map((item) => item.id)).toEqual(['ok']);
    expect(store().movingTemplate).toBeNull();
  });

  it('derives provenance for a legacy seed id with null columns, and for it alone', async () => {
    mockMovingRows = [remote('default-internet', null, null), remote('default-foo', null, null)];
    await store().fetchFromSupabase();
    expect(store().movingItems.find((item) => item.id === 'default-internet')!.templateRef).toEqual(ref('internet'));
    expect(store().movingItems.find((item) => item.id === 'default-foo')!.templateRef).toBeUndefined();
    expect(store().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 1 });
  });

  it('does not overwrite a local row with the same id (refresh stays append-only)', async () => {
    useHouseholdStore.setState({ movingItems: [{ id: 'r1', label: 'Local', checked: true }] });
    mockMovingRows = [remote('r1', 'internet', 1)];
    await store().fetchFromSupabase();
    expect(store().movingItems).toEqual([{ id: 'r1', label: 'Local', checked: true }]);
  });

  it('discards a refresh that finishes after the account changed', async () => {
    mockMovingRows = [remote('r1', 'internet', 1)];
    let release!: () => void;
    mockSessionGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    mockAccount = B;
    store().clearLocal();
    release();
    await pending;
    expect(store().movingItems).toEqual([]);
    expect(store().movingTemplate).toBeNull();
  });
});

describe('APP-062 account binding for Moving writes (W6)', () => {
  const gated = () => {
    let release!: () => void;
    mockSessionGate = new Promise((resolve) => { release = resolve; });
    return () => { mockSessionGate = null; release(); };
  };

  it('writes a row owned by the account that acted, with provenance columns', async () => {
    store().startMovingFromTemplate();
    await settle();
    expect(movingCalls()).toHaveLength(1);
    expect(movingCalls()[0].rows).toHaveLength(5);
    expect(movingCalls()[0].rows!.every((row) => row.user_id === A && row.template_id === MOVING_TEMPLATE_ID)).toBe(true);
    store().addMovingItem('Order boxes');
    await settle();
    expect(movingCalls()[1].rows![0]).toMatchObject({
      user_id: A, label: 'Order boxes', template_id: null, template_version: null, template_item_id: null,
    });
  });

  it('an add pending across an account switch is dropped, never re-owned by the new account', async () => {
    const release = gated();
    store().addMovingItem('Account A item');
    mockAccount = B;
    release();
    await settle();
    expect(movingCalls()).toEqual([]);
  });

  it('a toggle pending across an account switch is dropped', async () => {
    store().addMovingItem('x');
    await settle();
    mockCalls.length = 0;
    const release = gated();
    store().toggleMovingItem(store().movingItems[0].id);
    mockAccount = B;
    release();
    await settle();
    expect(movingCalls()).toEqual([]);
  });

  it('a delete pending across an account switch is dropped', async () => {
    store().addMovingItem('x');
    await settle();
    mockCalls.length = 0;
    const release = gated();
    store().removeMovingItem(store().movingItems[0].id);
    mockAccount = B;
    release();
    await settle();
    expect(movingCalls()).toEqual([]);
  });

  it('even if a request does go out, it carries A as owner, so B can never receive it as its own', async () => {
    mockSessionUser = A; // the live session still answers as A while the shell already shows B
    const release = gated();
    store().addMovingItem('Account A item');
    mockAccount = B;
    release();
    await settle();
    expect(movingCalls().flatMap((call) => call.rows ?? []).every((row) => row.user_id === A)).toBe(true);
    expect(movingCalls().flatMap((call) => call.rows ?? []).some((row) => row.user_id === B)).toBe(false);
  });

  it('A to B and back to A before the write resolves: the write is still A\'s own and never B\'s', async () => {
    const release = gated();
    store().addMovingItem('Account A item');
    mockAccount = B;
    mockAccount = A;
    release();
    await settle();
    const rows = movingCalls().flatMap((call) => call.rows ?? []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: A, label: 'Account A item' });
  });

  it('a delete filters on the initiating account', async () => {
    store().addMovingItem('x');
    await settle();
    const id = store().movingItems[0].id;
    store().removeMovingItem(id);
    await settle();
    expect(movingCalls().find((call) => call.op === 'delete')).toMatchObject({ user: A, id });
  });

  it('writes nothing remotely while signed out, but still updates local state', async () => {
    mockAccount = null;
    store().addMovingItem('offline');
    await settle();
    expect(store().movingItems).toHaveLength(1);
    expect(movingCalls()).toEqual([]);
  });

  it('logout clears the checklist and the marker', async () => {
    store().startMovingFromTemplate();
    store().clearLocal();
    expect(store().movingItems).toEqual([]);
    expect(store().movingTemplate).toBeNull();
  });
});

describe('APP-062 leaves Shopping untouched', () => {
  it('keeps the original direct Shopping write with the server-checked user', async () => {
    store().addShoppingItem('Milk');
    await settle();
    const call = mockCalls.find((entry) => entry.table === 'household_shopping_items');
    expect(call?.rows).toEqual([{ id: expect.any(String), user_id: A, label: 'Milk', checked: false }]);
  });
});

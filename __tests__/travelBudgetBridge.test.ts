import { minorUnits } from '@/core/money/minorUnits';

const mockLink = jest.fn((_input: unknown) => Promise.resolve<'linked'>('linked'));
const mockFetch = jest.fn((_tripId: unknown) => Promise.resolve([]));
let mockUser: { id: string } | null = null;

jest.mock('@/features/economy/travelFinancialBridge', () => ({
  linkTripExpense: (input: unknown) => mockLink(input),
  fetchTripFinancialProjection: (tripId: unknown) => mockFetch(tripId),
}));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: mockUser } })) } },
}));
jest.mock('@/utils/trip/tripReminder', () => ({
  scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn(),
}));
jest.mock('@/utils/shared/attachmentStorage', () => ({
  cleanupAttachments: jest.fn(), deleteCachedAttachmentFile: jest.fn(),
}));

import { travelMoneyMigration } from '@/core/storage/migrations/travelMoney';
import { settledTripSpend } from '@/features/travel/financialReadContract';
import { useTripsStore } from '@/store/useTripsStore';
import type { TripFinancialProjection } from '@/types/trip';

const v0 = (amount: number, budget: number | null = 1200.5) => ({
  state: {
    trips: [{ id: 'trip', budget }],
    expenses: [{
      id: 'legacy', tripId: 'trip', name: 'Train', amount, category: 'transport',
      attachments: [], createdAt: '2020-01-02T00:00:00.000Z',
    }],
    packingItems: [], participants: [], myUserId: null,
  },
  version: 0,
});

function projection(overrides: Partial<TripFinancialProjection> = {}): TripFinancialProjection {
  return {
    tripId: 'trip', expenseOwnerId: 'owner', expenseId: 'expense', name: 'Hotel',
    amount: minorUnits(10_000), category: 'accommodation', transactionDate: '2026-07-03',
    semantic: 'expense', status: 'booked', ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  useTripsStore.setState({
    trips: [], expenses: [], packingItems: [], participants: [], myUserId: null,
    financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
    pendingExpenseDrafts: {},
  });
});

describe('APP-059 Travel persistence migration', () => {
  it('converts safe money, preserves the legacy row, and never invents a transaction date', () => {
    const migrated = travelMoneyMigration.steps[0](v0(12.34)) as any;
    expect(migrated.version).toBe(1);
    expect(migrated.state.trips[0]).toMatchObject({ budget: 120_050 });
    expect(migrated.state.expenses[0]).toMatchObject({
      id: 'legacy', amount: 12.34, amountMinor: 1234,
      createdAt: '2020-01-02T00:00:00.000Z',
      resolutionStatus: 'requires-transaction-date',
    });
    expect(migrated.state.expenses[0]).not.toHaveProperty('transactionDate');
    expect(migrated.state.pendingExpenseDrafts).toEqual({});
    expect(travelMoneyMigration.validateCurrent(migrated)).toBe(true);
  });

  it('preserves unsafe legacy money unresolved without rounding it', () => {
    const migrated = travelMoneyMigration.steps[0](v0(12.345, 12.345)) as any;
    expect(migrated.state.expenses[0].amount).toBe(12.345);
    expect(migrated.state.expenses[0]).not.toHaveProperty('amountMinor');
    expect(migrated.state.trips[0]).toMatchObject({ budget: null, legacyBudgetMajor: 12.345 });
    expect(migrated.state.expenses[0]).not.toHaveProperty('transactionDate');
  });
});

describe('APP-059 Economy-backed settled trip spend', () => {
  it('counts booked resolved expenses, subtracts refunds, ignores transfers and deduplicates identity', () => {
    const expense = projection();
    expect(settledTripSpend([
      expense,
      { ...expense },
      projection({ expenseId: 'refund', amount: minorUnits(2_500), semantic: 'refund' }),
      projection({ expenseId: 'transfer', amount: minorUnits(99_999), semantic: 'transfer' }),
    ])).toBe(7_500);
  });

  it('has no path for unresolved legacy records, so they cannot count', () => {
    expect(settledTripSpend([])).toBe(0);
  });
});

describe('APP-059 explicit transaction dates', () => {
  it('rejects a new Travel expense with a missing date', async () => {
    const result = await useTripsStore.getState().addTripExpense({
      expenseId: 'draft-1', tripId: 'trip', name: 'Train', amount: minorUnits(2_500), category: 'transport', transactionDate: '',
    });
    expect(result).toBeNull();
    expect(mockLink).not.toHaveBeenCalled();
  });

  it('passes a valid explicit date into the atomic Economy link operation', async () => {
    mockUser = { id: 'owner' };
    const result = await useTripsStore.getState().addTripExpense({
      expenseId: 'draft-1', tripId: 'trip', name: 'Train', amount: minorUnits(2_500), category: 'transport', transactionDate: '2026-05-04',
    });
    expect(result).toBe('draft-1');
    expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({
      expectedAccountId: 'owner', expenseId: 'draft-1', transactionDate: '2026-05-04',
    }));
  });

  it('keeps a legacy row intact until a valid date is supplied, then makes it eligible', async () => {
    // The owner's own unattributed history on their own trip (APP-059 review #1 rule).
    mockUser = { id: 'owner' };
    useTripsStore.setState({ trips: [{
      id: 'trip', ownerId: 'owner', name: 'Trip', startDate: '2026-05-01', endDate: '2026-05-08',
      budget: null, documents: [], createdAt: '2026-01-01T00:00:00.000Z',
    }] });
    useTripsStore.setState({ expenses: [{
      id: 'legacy', tripId: 'trip', name: 'Train', amount: 25, amountMinor: minorUnits(2_500),
      category: 'transport', attachments: [], resolutionStatus: 'requires-transaction-date',
    }] });
    const missing = await useTripsStore.getState().resolveLegacyTripExpense({
      id: 'legacy', name: 'Train', amount: minorUnits(2_500), category: 'transport', transactionDate: '',
    });
    expect(missing).toBe('failed');
    expect(useTripsStore.getState().expenses).toHaveLength(1);
    expect(mockLink).not.toHaveBeenCalled();

    const resolved = await useTripsStore.getState().resolveLegacyTripExpense({
      id: 'legacy', name: 'Train', amount: minorUnits(2_500), category: 'transport', transactionDate: '2026-05-04',
    });
    expect(resolved).toBe('resolved');
    expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({
      expectedAccountId: 'owner', expenseId: 'legacy', legacyTripExpenseId: 'legacy', transactionDate: '2026-05-04',
    }));
    expect(useTripsStore.getState().expenses).toEqual([]);
  });
});

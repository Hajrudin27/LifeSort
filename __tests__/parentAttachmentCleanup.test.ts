import { Attachment } from '@/types/attachment';
import { Expense } from '@/types/expense';
import { Trip, TripAttachment, TripExpense } from '@/types/trip';
import { Warranty } from '@/types/warranty';

jest.mock('@/core/storage/documentCacheStorage', () => {
  const mockDeleteCachedAttachmentFile = jest.fn(() => Promise.resolve());
  return {
    __mockDeleteCachedAttachmentFile: mockDeleteCachedAttachmentFile,
    documentMetadataEncryptedStorage: {
      getItem: jest.fn(() => Promise.resolve(null)),
      setItem: jest.fn(() => Promise.resolve()),
      removeItem: jest.fn(() => Promise.resolve()),
    },
    ATTACHMENTS_DIR: 'file:///doc/attachments/',
    clearPersistentAttachmentCache: jest.fn(() => Promise.resolve()),
    clearTemporaryAttachmentCache: jest.fn(() => Promise.resolve()),
    deleteCachedAttachmentFile: mockDeleteCachedAttachmentFile,
    persistEncryptedAttachmentFile: jest.fn((uri: string) => Promise.resolve(`file:///doc/attachments/${uri.split('/').pop()}.lsenc`)),
  };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user_1' } } })),
    },
    from: jest.fn(() => {
      const deleteBuilder: { eq: jest.Mock; in: jest.Mock } = {
        eq: jest.fn(),
        in: jest.fn(() => Promise.resolve({ error: null })),
      };
      deleteBuilder.eq.mockReturnValue(deleteBuilder);
      return {
        upsert: jest.fn(() => Promise.resolve({ error: null })),
        delete: jest.fn(() => deleteBuilder),
        select: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
          in: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      };
    }),
  },
}));

jest.mock('@/utils/warranty/warrantyReminder', () => ({
  cancelWarrantyReminder: jest.fn(),
  scheduleWarrantyReminder: jest.fn(),
}));

jest.mock('@/utils/trip/tripReminder', () => ({
  cancelTripPackingReminder: jest.fn(),
  scheduleTripPackingReminder: jest.fn(),
}));

jest.mock('@/utils/trip/currencyConversion', () => ({
  fetchExchangeRate: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('@/utils/shared/attachmentSync', () => ({
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
}));

import { useExpensesStore } from '@/store/useExpensesStore';
import { useTripsStore } from '@/store/useTripsStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';

const mockDeleteCachedAttachmentFile = jest.requireMock(
  '@/core/storage/documentCacheStorage',
).__mockDeleteCachedAttachmentFile as jest.Mock;

function attachment(id: string, uri = `file:///doc/attachments/${id}.lsenc`): Attachment {
  return {
    id,
    uri,
    name: `${id}.jpg`,
    kind: 'image',
  };
}

function expense(id: string, nextPaymentDate = '2026-09-01', attachments: Attachment[] = []): Expense {
  return {
    id,
    seriesId: 'series-1',
    isRecurring: true,
    name: id,
    amount: 100,
    category: 'home',
    nextPaymentDate,
    attachments,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function warranty(id: string, attachments: Attachment[] = []): Warranty {
  return {
    id,
    name: id,
    type: 'warranty',
    expiryDate: '2027-09-01',
    attachments,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function tripAttachment(id: string, uri = `file:///doc/attachments/${id}.lsenc`): TripAttachment {
  return {
    id,
    uri,
    name: `${id}.jpg`,
    kind: 'image',
  };
}

function trip(id: string, documents: TripAttachment[] = []): Trip {
  return {
    id,
    name: id,
    startDate: '2026-09-10',
    endDate: '2026-09-14',
    budget: null,
    documents,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function tripExpense(id: string, tripId: string, attachments: TripAttachment[] = []): TripExpense {
  return {
    id,
    tripId,
    name: id,
    amount: 100,
    category: 'food',
    attachments,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('APP-029 parent attachment cache cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteCachedAttachmentFile.mockResolvedValue(undefined);
    useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
    useWarrantiesStore.setState({ warranties: [] });
    useTripsStore.setState({
      trips: [],
      expenses: [],
      packingItems: [],
      participants: [],
      myUserId: null,
    });
  });

  it('removeExpense removes the expense, cleans its local attachments and leaves other expense files untouched', () => {
    const target = expense('expense-1', '2026-09-01', [
      attachment('target-1'),
      attachment('target-2'),
      attachment('remote', 'https://storage.example/signed'),
    ]);
    const other = expense('expense-2', '2026-09-01', [attachment('other-1')]);
    useExpensesStore.setState({ expenses: [target, other] });

    useExpensesStore.getState().removeExpense(target.id);

    expect(useExpensesStore.getState().expenses.map((e) => e.id)).toEqual([other.id]);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/target-1.lsenc');
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/target-2.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('https://storage.example/signed');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/other-1.lsenc');
  });

  it('deleteRecurringFromMonth cleans removed recurring instances and leaves retained instances untouched', () => {
    const august = expense('august', '2026-08-01', [attachment('august')]);
    const september = expense('september', '2026-09-01', [attachment('september')]);
    const october = expense('october', '2026-10-01', [attachment('october')]);
    const otherSeries = { ...expense('other', '2026-10-01', [attachment('other-series')]), seriesId: 'series-2' };
    useExpensesStore.setState({ expenses: [august, september, october, otherSeries] });

    useExpensesStore.getState().deleteRecurringFromMonth('series-1', '2026-09');

    expect(useExpensesStore.getState().expenses.map((e) => e.id).sort()).toEqual(['august', 'other']);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/september.lsenc');
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/october.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/august.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/other-series.lsenc');
  });

  it('updateExpense recurring truncation cleans removed future attachments but not the surviving edited expense', () => {
    const edited = expense('edited', '2026-09-01', [attachment('edited')]);
    const future = expense('future', '2026-10-01', [attachment('future')]);
    const otherSeries = { ...expense('other', '2026-11-01', [attachment('other')]), seriesId: 'series-2' };
    useExpensesStore.setState({ expenses: [edited, future, otherSeries] });

    useExpensesStore.getState().updateExpense('edited', { amount: 250 });

    expect(useExpensesStore.getState().expenses.map((e) => e.id).sort()).toEqual(['edited', 'other']);
    expect(useExpensesStore.getState().expenses.find((e) => e.id === 'edited')?.amount).toBe(250);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/future.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/edited.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/other.lsenc');
  });

  it('removeWarranty cleans every local attachment belonging to the deleted warranty only', () => {
    const target = warranty('warranty-1', [attachment('warranty-target-1'), attachment('warranty-target-2')]);
    const other = warranty('warranty-2', [attachment('warranty-other')]);
    useWarrantiesStore.setState({ warranties: [target, other] });

    useWarrantiesStore.getState().removeWarranty(target.id);

    expect(useWarrantiesStore.getState().warranties.map((w) => w.id)).toEqual([other.id]);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/warranty-target-1.lsenc');
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/warranty-target-2.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/warranty-other.lsenc');
  });

  it('removeTripExpense cleans that trip expense attachments', () => {
    const target = tripExpense('expense-1', 'trip-1', [tripAttachment('trip-expense-target')]);
    const other = tripExpense('expense-2', 'trip-1', [tripAttachment('trip-expense-other')]);
    useTripsStore.setState({ expenses: [target, other] });

    useTripsStore.getState().removeTripExpense(target.id);

    expect(useTripsStore.getState().expenses.map((e) => e.id)).toEqual([other.id]);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/trip-expense-target.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/trip-expense-other.lsenc');
  });

  it('removeTrip cleans trip documents and removed trip-expense attachments only', () => {
    const targetTrip = trip('trip-1', [tripAttachment('trip-doc-1'), tripAttachment('trip-doc-2')]);
    const otherTrip = trip('trip-2', [tripAttachment('other-trip-doc')]);
    const removedExpense = tripExpense('expense-1', 'trip-1', [tripAttachment('trip-expense-doc')]);
    const otherExpense = tripExpense('expense-2', 'trip-2', [tripAttachment('other-expense-doc')]);
    useTripsStore.setState({
      trips: [targetTrip, otherTrip],
      expenses: [removedExpense, otherExpense],
      packingItems: [{ id: 'packing-1', tripId: 'trip-1', label: 'Passport', checked: false, isDefault: false, category: 'essentials' }],
      participants: [{ tripId: 'trip-1', ownerId: 'owner', userId: 'user', invitedEmail: 'x@example.com', status: 'accepted', invitedAt: '2026-09-01T00:00:00.000Z' }],
    });

    useTripsStore.getState().removeTrip(targetTrip.id);

    expect(useTripsStore.getState().trips.map((tr) => tr.id)).toEqual([otherTrip.id]);
    expect(useTripsStore.getState().expenses.map((e) => e.id)).toEqual([otherExpense.id]);
    expect(useTripsStore.getState().packingItems).toEqual([]);
    expect(useTripsStore.getState().participants).toEqual([]);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/trip-doc-1.lsenc');
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/trip-doc-2.lsenc');
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/trip-expense-doc.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/other-trip-doc.lsenc');
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith('file:///doc/attachments/other-expense-doc.lsenc');
  });

  it('filesystem cleanup failure does not undo parent record deletion', () => {
    const target = expense('expense-1', '2026-09-01', [attachment('target')]);
    useExpensesStore.setState({ expenses: [target] });
    mockDeleteCachedAttachmentFile.mockRejectedValueOnce(new Error('delete failed'));

    useExpensesStore.getState().removeExpense(target.id);

    expect(useExpensesStore.getState().expenses).toEqual([]);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///doc/attachments/target.lsenc');
  });
});

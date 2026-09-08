/// <reference types="node" />

/**
 * APP-022 — sletning skal gøre det, den siger, i den rigtige rækkefølge.
 *
 * Rækkefølgen er ikke kosmetik. Filerne kan kun fjernes, mens sessionen lever,
 * så de skal væk før kontoen. Bytter nogen om på det, fejler sletningen af
 * filer i stilhed, og brugerens kvitteringer bliver liggende i skyen efter at
 * kontoen er væk — uden at nogen opdager det.
 */

const mockCalls: string[] = [];

let mockAttachmentRows: { storage_path: string | null }[] = [];
let mockRpcError: { message: string } | null = null;
let mockUserId: string | null = 'user-1';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => {
        mockCalls.push('auth.getUser');
        return { data: { user: mockUserId ? { id: mockUserId } : null } };
      }),
      signOut: jest.fn(async () => {
        mockCalls.push('auth.signOut');
        return { error: null };
      }),
    },
    from: jest.fn(() => ({
      select: () => ({
        eq: async () => {
          mockCalls.push('select.attachments');
          return { data: mockAttachmentRows, error: null };
        },
      }),
    })),
    storage: {
      from: jest.fn(() => ({
        remove: jest.fn(async (paths: string[]) => {
          mockCalls.push(`storage.remove(${paths.length})`);
          return { error: null };
        }),
      })),
    },
    rpc: jest.fn(async (name: string) => {
      mockCalls.push(`rpc.${name}`);
      return { error: mockRpcError };
    }),
  },
}));

jest.mock('@/core/auth/clearLocalUserData', () => ({
  clearLocalUserData: jest.fn(async () => {
    mockCalls.push('clearLocalUserData');
  }),
}));

jest.mock('@/features/localStores', () => ({ LOCAL_STORE_RESETS: [] }));

import { deleteAccount, type DeleteAccountStage } from '@/core/auth/deleteAccount';

beforeEach(() => {
  mockCalls.length = 0;
  mockAttachmentRows = [{ storage_path: 'user-1/warranty/a.jpg' }, { storage_path: 'user-1/expense/b.pdf' }];
  mockRpcError = null;
  mockUserId = 'user-1';
});

describe('rækkefølgen', () => {
  it('fjerner filerne før kontoen', async () => {
    await deleteAccount();
    expect(mockCalls.indexOf('storage.remove(2)')).toBeLessThan(mockCalls.indexOf('rpc.delete_my_account'));
  });

  it('rydder telefonen efter kontoen er væk', async () => {
    await deleteAccount();
    expect(mockCalls.indexOf('rpc.delete_my_account')).toBeLessThan(mockCalls.indexOf('clearLocalUserData'));
  });

  it('melder hvert trin, mens det sker', async () => {
    // Uden det ser brugeren kun en knap, der er trykket ned, mens hendes konto
    // bliver slettet.
    const stages: DeleteAccountStage[] = [];
    await deleteAccount((stage) => stages.push(stage));
    expect(stages).toEqual(['files', 'account', 'local']);
  });
});

describe('når noget går galt', () => {
  it('siger fra uden at røre noget, hvis ingen er logget ind', async () => {
    mockUserId = null;
    const result = await deleteAccount();
    expect(result).toEqual({
      ok: false,
      reason: 'not_authenticated',
      failedAt: 'files',
      filesAlreadyDeleted: false,
    });
    expect(mockCalls).not.toContain('rpc.delete_my_account');
  });

  it('fortæller at filerne allerede var væk, hvis kontoen fejler bagefter', async () => {
    // Det er den ærlige besked. Brugeren har mistet sine filer og har stadig en
    // konto, og det skal hun kunne se med det samme.
    mockRpcError = { message: 'unexpected_failure' };
    const result = await deleteAccount();
    expect(result).toEqual({
      ok: false,
      reason: 'unknown',
      failedAt: 'account',
      filesAlreadyDeleted: true,
    });
  });

  it('genkender en konto, der ikke må slettes', async () => {
    mockRpcError = { message: 'admin_account' };
    const result = await deleteAccount();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('admin_account');
  });

  it('rydder ikke telefonen, når kontoen stadig findes', async () => {
    // Ellers ville brugeren miste sine lokale data uden at have mistet kontoen.
    mockRpcError = { message: 'unexpected_failure' };
    await deleteAccount();
    expect(mockCalls).not.toContain('clearLocalUserData');
  });

  it('rydder telefonen, selv hvis afmeldingen driller', async () => {
    // Kontoen er væk på dette tidspunkt. En slettet brugers data må ikke blive
    // liggende, fordi et sidste kald fejlede.
    const { supabase } = require('@/lib/supabase');
    supabase.auth.signOut.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    const result = await deleteAccount();
    expect(result.ok).toBe(true);
    expect(mockCalls).toContain('clearLocalUserData');
  });
});

describe('filer', () => {
  it('springer sletningen over, når der ingen er', async () => {
    mockAttachmentRows = [];
    const result = await deleteAccount();
    expect(result.ok).toBe(true);
    expect(mockCalls.some((call) => call.startsWith('storage.remove'))).toBe(false);
  });

  it('ignorerer rækker uden en sti', async () => {
    // En vedhæftning, der aldrig nåede op i skyen, har ingen sti at slette.
    mockAttachmentRows = [{ storage_path: null }, { storage_path: 'user-1/a.jpg' }];
    await deleteAccount();
    expect(mockCalls).toContain('storage.remove(1)');
  });
});

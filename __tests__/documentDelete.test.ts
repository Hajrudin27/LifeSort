/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import {
  clearDocumentSignedUrlCache,
  deleteDocument,
  documentReadUrl,
  type DocumentDeleteResult,
} from '@/core/documents/documentSync';

/**
 * APP-056 — the client half of the per-document delete lifecycle.
 *
 * begin → remove → finalize, and the thing under test is who gets to decide.
 * The server decides whether the window is open and whether the object is gone;
 * Storage's own answer is only ever a hint, because a removal can report an error
 * and have worked, or throw after its request already landed. So every scenario
 * below varies what Storage *says*, and checks that success is claimed only when
 * finalize — the server's reading of storage.objects — says so.
 */

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const OTHER_USER = '8c2d1e4f-7b3a-4c5d-9e0f-1a2b3c4d5e6f';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_DOC = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PATH = `${USER}/${DOC}`;
const OTHER_PATH = `${USER}/${OTHER_DOC}`;

type Reply = { data?: unknown; error?: unknown };

const mockCalls: string[] = [];
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockCreateSignedUrl = jest.fn();
let mockBegin: () => Promise<Reply>;
let mockRemove: () => Promise<Reply>;
let mockFinalize: () => Promise<Reply>;

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///app/cache/',
  deleteAsync: jest.fn(() => Promise.resolve()),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    // Any direct table access during deletion would be a bypass of the lifecycle.
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: jest.fn(async (name: string, args: unknown) => {
      mockCalls.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (name === 'begin_my_document_deletion') return mockBegin();
      if (name === 'finalize_my_document_deletion') return mockFinalize();
      throw new Error(`unexpected rpc ${name}`);
    }),
    storage: {
      from: jest.fn((bucket: string) => ({
        remove: jest.fn(async (paths: string[]) => {
          mockCalls.push(`remove:${bucket}:${paths.join(',')}`);
          return mockRemove();
        }),
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      })),
    },
  },
}));

const ready = (storagePath: unknown = PATH): Reply => ({ data: { status: 'ready', storage_path: storagePath }, error: null });
const began = (): boolean => mockCalls.some((call) => call.startsWith('rpc:begin_my_document_deletion'));
const removed = (): boolean => mockCalls.some((call) => call.startsWith('remove:'));
const finalized = (): boolean => mockCalls.some((call) => call.startsWith('rpc:finalize_my_document_deletion'));

const SUCCESS: DocumentDeleteResult = { ok: true, outcome: 'deleted' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  clearDocumentSignedUrlCache();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } } });
  mockBegin = async () => ready();
  mockRemove = async () => ({ data: [{ name: PATH }], error: null });
  mockFinalize = async () => ({ data: 'deleted', error: null });
});

describe('ingen netværkskald før der er en session og en kanonisk sti', () => {
  it('uden session sker der intet', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'not-authenticated' });
    expect(mockCalls).toEqual([]);
  });

  it('en session, der ikke kan læses, behandles som ingen session', async () => {
    mockGetUser.mockRejectedValue(new Error('offline'));
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'not-authenticated' });
    expect(mockCalls).toEqual([]);
  });

  it.each([
    ['en sti i stedet for et id', PATH],
    ['traversal', `../${OTHER_USER}/${DOC}`],
    ['et filnavn', 'lease-agreement.pdf'],
    ['tom streng', ''],
  ])('et id, der ikke kan danne en kanonisk sti (%s), rører intet', async (_label, id) => {
    expect(await deleteDocument(id)).toEqual({ ok: false, reason: 'not-found' });
    expect(mockCalls).toEqual([]);
  });
});

describe('den kanoniske sti', () => {
  it('sender kun dokument-id\'et og fjerner præcis stien, der er afledt af sessionen og id\'et', async () => {
    expect(await deleteDocument(DOC)).toEqual(SUCCESS);

    expect(mockCalls).toEqual([
      `rpc:begin_my_document_deletion:${JSON.stringify({ p_document_id: DOC })}`,
      `remove:documents:${PATH}`,
      `rpc:finalize_my_document_deletion:${JSON.stringify({ p_document_id: DOC })}`,
    ]);
    // The server is never handed a user id or a path to act on.
    expect(mockCalls.join(' ')).not.toMatch(/user_id|storage_path|p_user/);
  });

  it.each([
    ['en anden brugers præfiks', `${OTHER_USER}/${DOC}`],
    ['et andet dokument', OTHER_PATH],
    ['et ekstra segment', `${PATH}/lease-agreement.pdf`],
    ['traversal', `${USER}/../${OTHER_USER}/${DOC}`],
    ['en indledende skråstreg', `/${PATH}`],
    ['anden versalisering', `${USER.toUpperCase()}/${DOC}`],
    ['null som sti', null],
    ['en sti der ikke er tekst', 42],
  ])('afviser %s fra begin, før Storage røres', async (_label, storagePath) => {
    mockBegin = async () => ready(storagePath);

    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'invalid-response' });
    expect(removed()).toBe(false);
    expect(finalized()).toBe(false);
  });

  it.each([
    ['null', null],
    ['en liste', [{ status: 'ready', storage_path: PATH }]],
    ['en streng', 'ready'],
    ['en ukendt status', { status: 'maybe', storage_path: PATH }],
    ['ingen status', { storage_path: PATH }],
    ['ready uden sti', { status: 'ready' }],
  ])('afviser et begin-svar, der ikke kan stoles på (%s)', async (_label, data) => {
    mockBegin = async () => ({ data, error: null });

    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'invalid-response' });
    expect(removed()).toBe(false);
    expect(finalized()).toBe(false);
  });
});

describe('begin', () => {
  it('en fejlet begin rører ikke Storage og kalder ikke finalize', async () => {
    mockBegin = async () => ({ data: null, error: { message: 'network' } });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'delete-incomplete' });
    expect(removed()).toBe(false);
    expect(finalized()).toBe(false);
  });

  it('en kastet begin gør heller ikke', async () => {
    mockBegin = async () => { throw new Error('socket closed'); };
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'delete-incomplete' });
    expect(removed()).toBe(false);
  });

  it('serverens not_authenticated bliver til not-authenticated', async () => {
    mockBegin = async () => ({ data: null, error: { message: 'not_authenticated' } });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'not-authenticated' });
    expect(removed()).toBe(false);
  });

  it('already-deleted er en succes uden Storage og uden finalize', async () => {
    mockBegin = async () => ({ data: { status: 'already-deleted' }, error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: true, outcome: 'already-deleted' });
    expect(removed()).toBe(false);
    expect(finalized()).toBe(false);
  });

  it('not-found stopper uden at røre noget', async () => {
    mockBegin = async () => ({ data: { status: 'not-found' }, error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'not-found' });
    expect(removed()).toBe(false);
    expect(finalized()).toBe(false);
  });
});

describe('Storage-svaret er et fingerpeg — finalize afgør', () => {
  it('Storage OK + finalize deleted → slettet', async () => {
    expect(await deleteDocument(DOC)).toEqual(SUCCESS);
  });

  it('Storage kaster (anmodningen kan være nået frem) + finalize deleted → slettet', async () => {
    mockRemove = async () => { throw new Error('connection reset'); };
    expect(await deleteDocument(DOC)).toEqual(SUCCESS);
    expect(finalized()).toBe(true);
  });

  it('Storage svarer med error, men objektet var faktisk væk → slettet', async () => {
    mockRemove = async () => ({ data: null, error: { message: 'gateway timeout' } });
    expect(await deleteDocument(DOC)).toEqual(SUCCESS);
    expect(finalized()).toBe(true);
  });

  it('Storage fejler reelt, og finalize ser objektet → ingen succes, kan prøves igen', async () => {
    mockRemove = async () => ({ data: null, error: { message: 'row-level security' } });
    mockFinalize = async () => ({ data: 'object-present', error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'delete-incomplete' });
  });

  it.each([
    ['et svar, der går tabt', async (): Promise<Reply> => ({ data: null, error: { message: 'network' } })],
    ['en kastet finalize', async (): Promise<Reply> => { throw new Error('socket closed'); }],
    ['not-requested (vinduet udløb)', async (): Promise<Reply> => ({ data: 'not-requested', error: null })],
    ['et ukendt svar', async (): Promise<Reply> => ({ data: 'done', error: null })],
    ['et objekt i stedet for en status', async (): Promise<Reply> => ({ data: { status: 'deleted' }, error: null })],
    ['intet svar', async (): Promise<Reply> => ({ data: null, error: null })],
  ])('%s giver aldrig en falsk succes', async (_label, finalize) => {
    mockFinalize = finalize;
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'delete-incomplete' });
  });

  it('finalize already-deleted (et tidligere forsøg nåede i mål) → succes', async () => {
    mockFinalize = async () => ({ data: 'already-deleted', error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: true, outcome: 'already-deleted' });
  });

  it('finalize not-found meldes ikke som slettet', async () => {
    mockFinalize = async () => ({ data: 'not-found', error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('finalize not_authenticated bliver til not-authenticated', async () => {
    mockFinalize = async () => ({ data: null, error: { message: 'not_authenticated' } });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'not-authenticated' });
  });
});

describe('RETRY efter et tabt finalize-svar', () => {
  it('næste forsøg får sandheden at vide af begin — uden en ny Storage-sletning', async () => {
    // Attempt 1: the server committed, the answer never arrived.
    mockFinalize = async () => ({ data: null, error: { message: 'network' } });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'delete-incomplete' });

    // Attempt 2: the tombstone makes "already deleted" a fact the server states.
    mockCalls.length = 0;
    mockBegin = async () => ({ data: { status: 'already-deleted' }, error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: true, outcome: 'already-deleted' });
    expect(removed()).toBe(false);
  });

  it('bytes, der dukker op igen under et slettet id, fjernes før der meldes succes', async () => {
    // The server has a tombstone for this id AND an object at its canonical path, so
    // begin says ready — not already-deleted — and hands back that exact path. The
    // unchanged lifecycle removes the bytes, and only then does finalize confirm.
    mockBegin = async () => ready(PATH);
    mockFinalize = async () => ({ data: 'already-deleted', error: null });

    expect(await deleteDocument(DOC)).toEqual({ ok: true, outcome: 'already-deleted' });
    expect(mockCalls).toEqual([
      `rpc:begin_my_document_deletion:${JSON.stringify({ p_document_id: DOC })}`,
      `remove:documents:${PATH}`,
      `rpc:finalize_my_document_deletion:${JSON.stringify({ p_document_id: DOC })}`,
    ]);
  });

  it('et slettet id, hvis bytes stadig ligger der efter Storage-kaldet, meldes ikke som slettet', async () => {
    mockBegin = async () => ready(PATH);
    mockRemove = async () => ({ data: null, error: { message: 'network' } });
    mockFinalize = async () => ({ data: 'object-present', error: null });
    expect(await deleteDocument(DOC)).toEqual({ ok: false, reason: 'delete-incomplete' });
  });

  it('et forsøg, der stoppede efter Storage, gøres færdigt af det næste', async () => {
    mockFinalize = async () => ({ data: null, error: { message: 'network' } });
    expect((await deleteDocument(DOC)).ok).toBe(false);

    // The row survived; begin opens a fresh window, the (already gone) object is
    // removed again as a no-op, and finalize retires the row.
    mockCalls.length = 0;
    mockRemove = async () => ({ data: [], error: null });
    mockFinalize = async () => ({ data: 'deleted', error: null });
    expect(await deleteDocument(DOC)).toEqual(SUCCESS);
    expect(mockCalls).toHaveLength(3);
  });
});

describe('den signerede URL-cache', () => {
  beforeEach(() => {
    let minted = 0;
    mockCreateSignedUrl.mockImplementation(async (storagePath: string) => {
      minted += 1;
      return { data: { signedUrl: `https://storage.example/${storagePath === PATH ? 'a' : 'b'}-${minted}` } };
    });
  });

  it('glemmer kun det slettede dokuments URL, og først når serveren har bekræftet', async () => {
    const firstA = await documentReadUrl(PATH);
    const firstB = await documentReadUrl(OTHER_PATH);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);

    // A failed deletion changes nothing: the document still exists.
    mockFinalize = async () => ({ data: 'object-present', error: null });
    expect((await deleteDocument(DOC)).ok).toBe(false);
    expect(await documentReadUrl(PATH)).toBe(firstA);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);

    // A confirmed deletion drops that entry — and only that one.
    mockFinalize = async () => ({ data: 'deleted', error: null });
    expect(await deleteDocument(DOC)).toEqual(SUCCESS);
    expect(await documentReadUrl(OTHER_PATH)).toBe(firstB);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);
    expect(await documentReadUrl(PATH)).not.toBe(firstA);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(3);
  });

  it('already-deleted glemmer den også', async () => {
    const first = await documentReadUrl(PATH);
    mockBegin = async () => ({ data: { status: 'already-deleted' }, error: null });
    expect((await deleteDocument(DOC)).ok).toBe(true);
    expect(await documentReadUrl(PATH)).not.toBe(first);
  });
});

describe('ingen omveje og ingen lækager', () => {
  it('rører aldrig metadata-tabellen direkte og bruger aldrig kontosletningens frigivelse', async () => {
    for (const finalize of ['deleted', 'object-present', 'not-requested']) {
      mockFinalize = async () => ({ data: finalize, error: null });
      await deleteDocument(DOC);
    }
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCalls.some((call) => call.includes('release_my_documents_for_account_deletion'))).toBe(false);

    // The account-wide release, and any direct table write, are also absent from
    // the deletion code itself — everything from the begin helper to the end of
    // deleteDocument.
    const source = fs.readFileSync(path.resolve(__dirname, '../core/documents/documentSync.ts'), 'utf8');
    const deletion = source.slice(
      source.indexOf('async function beginDocumentDeletion'),
      source.indexOf('export async function releaseOwnDocumentsForAccountDeletion'),
    );
    expect(deletion).toContain("supabase.rpc('begin_my_document_deletion'");
    expect(deletion).toContain("supabase.rpc('finalize_my_document_deletion'");
    expect(deletion).not.toContain('release_my_documents_for_account_deletion');
    expect(deletion).not.toMatch(/\.from\(['"]documents['"]\)/);
  });

  it('logger intet, og resultatet bærer hverken sti, bruger-id eller URL', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined));
    try {
      const results = [];
      for (const finalize of ['deleted', 'object-present']) {
        mockFinalize = async () => ({ data: finalize, error: null });
        results.push(await deleteDocument(DOC));
      }
      mockRemove = async () => { throw new Error(`failed ${PATH}`); };
      results.push(await deleteDocument(DOC));

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      for (const secret of [PATH, USER, DOC, 'https://', 'file://']) {
        expect(JSON.stringify(results)).not.toContain(secret);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

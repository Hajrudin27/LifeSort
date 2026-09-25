import * as FileSystem from 'expo-file-system/legacy';

import {
  cleanupTemporaryPickerFile,
  clearDocumentSignedUrlCache,
  documentReadUrl,
  fetchDocuments,
  isOwnTemporaryPickerFile,
  releaseOwnDocumentsForAccountDeletion,
  uploadDocument,
} from '@/core/documents/documentSync';
import { MAX_DOCUMENT_BYTES } from '@/core/documents/documents';

/**
 * APP-055 — the upload and the signed read.
 *
 * The two failure orders are the point. An object without a row is a file nobody
 * can reach, so it is taken back out; a row without a local record is recoverable
 * on the next fetch, so nothing remote is destroyed to tidy up local state.
 */

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const OTHER_USER = '8c2d1e4f-7b3a-4c5d-9e0f-1a2b3c4d5e6f';
const CACHE = 'file:///app/cache/';

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockCreateSignedUrl = jest.fn();
const mockInsert = jest.fn();
const mockSelectEq = jest.fn();
const mockGetUser = jest.fn();
const mockRpc = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///app/cache/',
  deleteAsync: jest.fn(() => Promise.resolve()),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true, size: 1024 })),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: jest.fn(() => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        remove: (...args: unknown[]) => mockRemove(...args),
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      })),
    },
    from: jest.fn(() => ({
      insert: (...args: unknown[]) => mockInsert(...args),
      select: jest.fn(() => ({
        eq: (...args: unknown[]) => mockSelectEq(...args),
      })),
    })),
  },
}));

const mockDeleteAsync = FileSystem.deleteAsync as jest.MockedFunction<typeof FileSystem.deleteAsync>;
const mockGetInfoAsync = FileSystem.getInfoAsync as jest.MockedFunction<typeof FileSystem.getInfoAsync>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The row the server would return for whatever id the upload minted. */
function serverEchoesInsert() {
  mockInsert.mockImplementation((row: Record<string, unknown>) => ({
    select: jest.fn(() => ({
      single: jest.fn(() => Promise.resolve({
        data: { ...row, created_at: '2026-09-25T09:00:00.000Z' },
        error: null,
      })),
    })),
  }));
}

function insertFails() {
  mockInsert.mockImplementation(() => ({
    select: jest.fn(() => ({
      single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    })),
  }));
}

const picked = (overrides: Record<string, unknown> = {}) => ({
  uri: `${CACHE}picked-file`,
  name: 'lease.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearDocumentSignedUrlCache();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } } });
  mockUpload.mockResolvedValue({ error: null });
  mockRemove.mockResolvedValue({ error: null });
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed-1' } });
  mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 } as never);
  mockRpc.mockResolvedValue({ data: [], error: null });
  serverEchoesInsert();
  global.fetch = jest.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(['bytes'])) })) as jest.Mock;
});

describe('den lykkelige vej', () => {
  it('lægger objektet op og registrerer det, og returnerer først derefter et dokument', async () => {
    const result = await uploadDocument(picked());

    expect(result.ok).toBe(true);
    const [storagePath, blob, options] = mockUpload.mock.calls[0];
    const documentId = String(storagePath).split('/')[1];

    expect(String(storagePath).split('/')[0]).toBe(USER);
    expect(documentId).toMatch(UUID);
    expect(blob).toBeInstanceOf(Blob);
    // Never an overwrite: the identity is new, so an existing object is a collision.
    expect(options).toMatchObject({ upsert: false, contentType: 'application/pdf' });

    expect(mockInsert).toHaveBeenCalledWith({
      id: documentId,
      user_id: USER,
      storage_path: `${USER}/${documentId}`,
      original_name: 'lease.pdf',
    });
    expect(mockRemove).not.toHaveBeenCalled();
    if (result.ok) expect(result.document).toMatchObject({ id: documentId, originalName: 'lease.pdf' });
  });

  it('holder filnavnet ude af objektstien', async () => {
    await uploadDocument(picked({ name: '../../escape/Årsopgørelse.pdf' }));
    const [storagePath] = mockUpload.mock.calls[0];
    expect(String(storagePath)).not.toContain('escape');
    expect(String(storagePath).split('/')).toHaveLength(2);
    // The name survives untouched where it belongs: in the metadata.
    expect(mockInsert.mock.calls[0][0].original_name).toBe('../../escape/Årsopgørelse.pdf');
  });

  it('giver hvert dokument sin egen sti', async () => {
    await uploadDocument(picked());
    await uploadDocument(picked());
    expect(mockUpload.mock.calls[0][0]).not.toBe(mockUpload.mock.calls[1][0]);
  });
});

describe('afvisninger før noget forlader telefonen', () => {
  it('afviser uden en session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await uploadDocument(picked())).toEqual({ ok: false, reason: 'not-authenticated' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('afviser et ubrugeligt filnavn', async () => {
    expect(await uploadDocument(picked({ name: '   ' }))).toEqual({ ok: false, reason: 'invalid-file' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('afviser en fil over 25 MiB før den læses som blob', async () => {
    expect(await uploadDocument(picked({ size: MAX_DOCUMENT_BYTES + 1 })))
      .toEqual({ ok: false, reason: 'invalid-file' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('spørger filsystemet når vælgeren ikke oplyser en størrelse', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: MAX_DOCUMENT_BYTES + 1 } as never);
    expect(await uploadDocument(picked({ size: undefined }))).toEqual({ ok: false, reason: 'invalid-file' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('fanger stadig en for stor fil når den oplyste størrelse løj', async () => {
    const big = new Blob(['x']);
    Object.defineProperty(big, 'size', { value: MAX_DOCUMENT_BYTES + 1 });
    global.fetch = jest.fn(() => Promise.resolve({ blob: () => Promise.resolve(big) })) as jest.Mock;
    expect(await uploadDocument(picked({ size: 10 }))).toEqual({ ok: false, reason: 'invalid-file' });
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('delvis fejl', () => {
  it('registrerer intet når objektet ikke kom op', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network' } });
    expect(await uploadDocument(picked())).toEqual({ ok: false, reason: 'upload-failed' });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('fjerner præcis det objekt det selv lagde op, når rækken fejler', async () => {
    insertFails();
    const result = await uploadDocument(picked());

    expect(result).toEqual({ ok: false, reason: 'metadata-failed' });
    const [storagePath] = mockUpload.mock.calls[0];
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith([storagePath]);
  });

  it('melder fejl frem for at tro på en række serveren ikke kunne bekræfte', async () => {
    // A row that decodes to nothing is the same as no row: no silent success.
    mockInsert.mockImplementation(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'not-a-uuid' }, error: null })),
      })),
    }));
    expect(await uploadDocument(picked())).toEqual({ ok: false, reason: 'metadata-failed' });
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('lader en fejlet oprydning stå frem for at fejle højlydt', async () => {
    insertFails();
    mockRemove.mockRejectedValue(new Error('offline'));
    expect(await uploadDocument(picked())).toEqual({ ok: false, reason: 'metadata-failed' });
  });
});

describe('vælgerens midlertidige fil', () => {
  it('accepterer en fil, der faktisk ligger i appens egen cache', () => {
    for (const own of [
      `${CACHE}picked-file`,
      `${CACHE}DocumentPicker/lease.pdf`,
      `${CACHE}picked%20file%20med%20mellemrum.pdf`,
      `${CACHE}Årsopgørelse.pdf`,
    ]) {
      expect(isOwnTemporaryPickerFile(own)).toBe(true);
    }
  });

  it.each([
    ['literal traversal', 'file:///app/cache/../documents/private.pdf'],
    ['encoded traversal', 'file:///app/cache/%2e%2e/documents/private.pdf'],
    ['encoded separator traversal', 'file:///app/cache%2f..%2fdocuments/private.pdf'],
    ['fully encoded traversal', 'file:///app/cache%2F%2E%2E%2Fdocuments/private.pdf'],
    ['double-encoded traversal', 'file:///app/cache/%252e%252e/documents/private.pdf'],
    ['backslash traversal', 'file:///app/cache/..\\documents/private.pdf'],
    ['encoded backslash', 'file:///app/cache/%5c..%5cdocuments/private.pdf'],
    ['single-dot segment', 'file:///app/cache/./../documents/private.pdf'],
    ['sibling directory sharing the prefix', 'file:///app/cache-evil/file.pdf'],
    ['the cache root itself', 'file:///app/cache/'],
    ['another app directory', 'file:///app/documents/file.pdf'],
    ['external storage', 'file:///storage/emulated/0/Download/lease.pdf'],
    ['content provider', 'content://com.android.providers.downloads/1'],
    ['remote url', 'https://example.test/x.pdf'],
    ['empty', ''],
  ])('afviser %s', (_label, uri) => {
    // A shared string prefix is not containment. Nothing here may be deleted.
    expect(isOwnTemporaryPickerFile(uri)).toBe(false);
  });

  it('sletter aldrig noget, der ikke beviseligt ligger i vores egen cache', async () => {
    for (const foreign of [
      'content://com.android.providers.downloads/1',
      'file:///storage/emulated/0/Download/lease.pdf',
      'file:///app/cache/../documents/private.pdf',
      'file:///app/cache/%2e%2e/documents/private.pdf',
      'file:///app/cache-evil/file.pdf',
      'https://example.test/x.pdf',
    ]) {
      await cleanupTemporaryPickerFile(foreign);
    }
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  it('rydder sin egen kopi op', async () => {
    await cleanupTemporaryPickerFile(`${CACHE}picked-file`);
    expect(mockDeleteAsync).toHaveBeenCalledWith(`${CACHE}picked-file`, { idempotent: true });
  });

  it('lader en fejlet oprydning være stille', async () => {
    mockDeleteAsync.mockRejectedValue(new Error('gone'));
    await expect(cleanupTemporaryPickerFile(`${CACHE}picked-file`)).resolves.toBeUndefined();
  });
});

describe('den signerede læsning', () => {
  it('udstedes på forlangende og er kortlivet', async () => {
    const url = await documentReadUrl(`${USER}/doc-1`);
    expect(url).toBe('https://storage.example/signed-1');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(`${USER}/doc-1`, 60 * 60);
  });

  it('genbruger fra hukommelsen indtil den nærmer sig udløb', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(0);
    await documentReadUrl(`${USER}/doc-1`);
    await documentReadUrl(`${USER}/doc-1`);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);

    // Inside the refresh margin (last 5 minutes) it is minted again.
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed-2' } });
    now.mockReturnValue(60 * 60 * 1000 - 60 * 1000);
    expect(await documentReadUrl(`${USER}/doc-1`)).toBe('https://storage.example/signed-2');
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('holder hver sti for sig', async () => {
    await documentReadUrl(`${USER}/doc-1`);
    await documentReadUrl(`${USER}/doc-2`);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('ryddes ved log ud, så næste konto ikke arver den forriges URL\'er', async () => {
    await documentReadUrl(`${USER}/doc-1`);
    clearDocumentSignedUrlCache();
    await documentReadUrl(`${USER}/doc-1`);
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('returnerer null frem for at gætte når signeringen fejler', async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null });
    expect(await documentReadUrl(`${USER}/doc-1`)).toBeNull();
    mockCreateSignedUrl.mockRejectedValue(new Error('offline'));
    expect(await documentReadUrl(`${USER}/doc-2`)).toBeNull();
  });
});

describe('hentning', () => {
  const row = (id: string) => ({
    id, user_id: USER, storage_path: `${USER}/${id}`,
    original_name: `${id}.pdf`, created_at: '2026-09-25T09:00:00.000Z',
  });
  const A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const B = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  it('afkoder serverens rækker og dropper de ubrugelige', async () => {
    mockSelectEq.mockReturnValue({
      order: jest.fn(() => Promise.resolve({ data: [row(A), { id: 'bad' }, row(B)], error: null })),
    });
    const documents = await fetchDocuments();
    expect(documents?.map((d) => d.id).sort()).toEqual([A, B].sort());
  });

  it('svarer null ved fejl, så en netværksfejl ikke ligner en tom konto', async () => {
    mockSelectEq.mockReturnValue({
      order: jest.fn(() => Promise.resolve({ data: null, error: { message: 'offline' } })),
    });
    expect(await fetchDocuments()).toBeNull();

    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await fetchDocuments()).toBeNull();
  });

  it('frigiver kontoens dokumenter og giver præcis de stier, der skal ryddes', async () => {
    mockRpc.mockResolvedValue({ data: [`${USER}/${A}`, `${USER}/${B}`], error: null });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toEqual([`${USER}/${A}`, `${USER}/${B}`]);
    expect(mockRpc).toHaveBeenCalledWith('release_my_documents_for_account_deletion');
  });

  it('skelner en tom konto fra en fejlet frigivelse', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toEqual([]);

    // null, ikke []: de to er forskellige fakta, og kontosletningen skal kunne
    // se forskel på dem.
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toBeNull();

    mockRpc.mockResolvedValue({ data: 'not-an-array', error: null });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toBeNull();

    mockRpc.mockRejectedValue(new Error('offline'));
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toBeNull();
  });

  it('giver hele listen tilbage, uændret, når hver eneste sti er kanonisk', async () => {
    mockRpc.mockResolvedValue({ data: [`${USER}/${A}`, `${USER}/${B}`], error: null });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toEqual([`${USER}/${A}`, `${USER}/${B}`]);

    mockRpc.mockResolvedValue({ data: [`${USER}/${A}`], error: null });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toEqual([`${USER}/${A}`]);
  });

  it.each([
    ['en fremmed ejer', ['someone-else/doc']],
    ['en gyldig OG en fremmed sti', [`${USER}/${A}`, `${OTHER_USER}/${B}`]],
    ['et ekstra sti-segment', [`${USER}/${A}/original-name.pdf`]],
    ['et malformet dokument-UUID', [`${USER}/not-a-uuid`]],
    ['et malformet ejer-UUID', ['not-a-uuid/' + A]],
    ['et element der ikke er en streng', [42]],
    ['et null-element', [null]],
    ['en dubleret kanonisk sti', [`${USER}/${A}`, `${USER}/${A}`]],
    ['en blandet gyldig/ugyldig liste', [`${USER}/${A}`, `${USER}/${A}/x.pdf`, `${USER}/${B}`]],
    ['en traversal', [`${USER}/../${OTHER_USER}/${A}`]],
    ['en tom streng', ['']],
  ])('afviser HELE manifestet ved %s', async (_label, data) => {
    // Alt eller intet. Et filtreret manifest kan ikke skelnes fra et komplet
    // et: flowet ville slette det, det forstod, konkludere at oprydningen var
    // færdig og destruere kontoen — og efterlade dét, den kasserede post
    // faktisk beskrev.
    mockRpc.mockResolvedValue({ data, error: null });
    expect(await releaseOwnDocumentsForAccountDeletion(USER)).toBeNull();
  });
});

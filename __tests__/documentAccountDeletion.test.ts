/**
 * APP-055 must not make APP-022 false.
 *
 * Storage objects do not cascade with `auth.users`, so a second private bucket is
 * a second place a deleted user's files can be left behind. And the two ways that
 * goes wrong are quiet ones: a query that failed looks like an account with no
 * documents, and a `.remove()` that resolved looks like a file that is gone.
 * Neither may be allowed to carry the flow past the point of no return.
 */

const mockCalls: string[] = [];
let mockAttachmentRows: { storage_path: string | null }[] = [];

/**
 * A stand-in for the server's durable state, not a canned answer.
 *
 * The release marks rows; it does not remove them. Modelling that here is the
 * whole point of the retry test: if the implementation ever went back to
 * deleting metadata during preparation, `mockServerDocumentPaths` would have to
 * be emptied for the mock to stay honest, and the second attempt would find
 * nothing.
 */
let mockServerDocumentPaths: string[] = [];
/**
 * Whether the server currently regards this account's documents as released.
 *
 * The real decision is `account_deletion_released_at` measured against
 * `document_release_window()` on the database clock; here it stands in for that
 * so a test can say "the window has since closed". The client never computes
 * this — it has no timer and no expiry logic — which is exactly what the
 * abandoned-attempt test below is checking.
 */
let mockServerReleaseIsCurrent = false;
let mockReleaseError: unknown = null;
let mockReleaseThrows = false;
let mockDocumentRemoveResult: { error: unknown } = { error: null };
let mockDocumentRemoveThrows = false;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11' } } })),
      signOut: jest.fn(async () => ({ error: null })),
    },
    from: jest.fn((table: string) => ({
      select: () => ({
        eq: async () => {
          mockCalls.push(`select.${table}`);
          return { data: mockAttachmentRows, error: null };
        },
      }),
    })),
    storage: {
      from: jest.fn((bucket: string) => ({
        remove: jest.fn(async (paths: string[]) => {
          mockCalls.push(`remove.${bucket}:${paths.join(',')}`);
          if (bucket === 'documents') {
            if (mockDocumentRemoveThrows) throw new Error('network');
            // The server refuses a removal that no current release authorizes,
            // exactly as the Storage policy does once the window has closed.
            if (!mockServerReleaseIsCurrent) return { error: { message: 'row-level security' } };
            return mockDocumentRemoveResult;
          }
          return { error: null };
        }),
      })),
    },
    rpc: jest.fn(async (name: string) => {
      mockCalls.push(`rpc.${name}`);
      if (name === 'release_my_documents_for_account_deletion') {
        if (mockReleaseThrows) throw new Error('network');
        if (mockReleaseError) return { data: null, error: mockReleaseError };
        // Marks and returns; it never removes. Every call opens a fresh window,
        // and repeating it gives back the same paths — which is what a retry
        // after an expired window depends on.
        mockServerReleaseIsCurrent = true;
        return { data: [...mockServerDocumentPaths], error: null };
      }
      if (name === 'delete_my_account') {
        // The account going is what finally takes the rows, through the cascade.
        mockServerDocumentPaths = [];
      }
      return { error: null };
    }),
  },
}));

jest.mock('@/core/auth/clearLocalUserData', () => ({
  clearLocalUserData: jest.fn(async () => { mockCalls.push('clearLocalUserData'); }),
}));
jest.mock('@/features/localStores', () => ({ LOCAL_STORE_RESETS: [] }));

import { deleteAccount } from '@/core/auth/deleteAccount';

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const B = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const called = (prefix: string) => mockCalls.some((entry) => entry.startsWith(prefix));

beforeEach(() => {
  mockCalls.length = 0;
  mockAttachmentRows = [{ storage_path: `${USER}/warranty/a.jpg` }];
  mockServerDocumentPaths = [`${USER}/${A}`, `${USER}/${B}`];
  mockServerReleaseIsCurrent = false;
  mockReleaseError = null;
  mockReleaseThrows = false;
  mockDocumentRemoveResult = { error: null };
  mockDocumentRemoveThrows = false;
});

describe('den lykkelige vej', () => {
  it('B + F: frigiver metadata, rydder objekterne og gør det FØR kontoen', async () => {
    const result = await deleteAccount();
    expect(result).toEqual({ ok: true });

    expect(mockCalls).toContain('rpc.release_my_documents_for_account_deletion');
    expect(mockCalls).toContain(`remove.documents:${USER}/${A},${USER}/${B}`);
    expect(mockCalls).toContain(`remove.attachments:${USER}/warranty/a.jpg`);

    // The release has to come first: an object may only be removed while the row
    // pointing at it carries a fresh release. Nothing is deleted by the release —
    // the order is marker, then bytes, then account, then the metadata cascade.
    const release = mockCalls.indexOf('rpc.release_my_documents_for_account_deletion');
    const removeDocuments = mockCalls.findIndex((c) => c.startsWith('remove.documents'));
    const account = mockCalls.indexOf('rpc.delete_my_account');
    expect(release).toBeLessThan(removeDocuments);

    // And both sweeps have to precede the account, because afterwards the session
    // allowed to touch those objects is the thing that was destroyed.
    expect(removeDocuments).toBeLessThan(account);
    expect(mockCalls.findIndex((c) => c.startsWith('remove.attachments'))).toBeLessThan(account);
    expect(account).toBeLessThan(mockCalls.indexOf('clearLocalUserData'));
  });

  it('A: en konto uden dokumenter fortsætter normalt', async () => {
    // A genuine empty result — not a disguised failure.
    mockServerDocumentPaths = [];
    const result = await deleteAccount();

    expect(result).toEqual({ ok: true });
    expect(called('remove.documents')).toBe(false);
    expect(mockCalls).toContain('rpc.delete_my_account');
  });

  it('accepterer et komplet, kanonisk manifest uændret', async () => {
    mockServerDocumentPaths = [`${USER}/${A}`, `${USER}/${B}`];
    expect(await deleteAccount()).toEqual({ ok: true });
    expect(mockCalls).toContain(`remove.documents:${USER}/${A},${USER}/${B}`);
  });
});

describe('fejl må ikke bære flowet forbi punktet uden tilbagevenden', () => {
  const expectStoppedAtFiles = (result: unknown) => {
    expect(result).toMatchObject({ ok: false, reason: 'unknown', failedAt: 'files' });
    expect(mockCalls).not.toContain('rpc.delete_my_account');
    expect(mockCalls).not.toContain('clearLocalUserData');
  };

  it('C: en fejlet frigivelse stopper ved files — kontoen slettes ikke', async () => {
    // The critical distinction: this is an error, not an empty account. Treating
    // it as empty would delete the account while its documents were still in the
    // bucket, and the session allowed to remove them would be gone.
    mockReleaseError = { message: 'offline' };
    expectStoppedAtFiles(await deleteAccount());
    expect(called('remove.documents')).toBe(false);
  });

  it('D: en remove, der svarer med { error }, stopper ved files', async () => {
    // Supabase reports a refusal in `error` rather than by throwing, so a
    // resolved promise is not a removed file.
    mockDocumentRemoveResult = { error: { message: 'row-level security' } };
    const result = await deleteAccount();

    expect(called('remove.documents')).toBe(true);
    expectStoppedAtFiles(result);
  });

  it('E: en kastet remove-fejl stopper på samme måde', async () => {
    mockDocumentRemoveThrows = true;
    expectStoppedAtFiles(await deleteAccount());
  });

  it('en kastet frigivelse stopper på samme måde', async () => {
    mockReleaseThrows = true;
    expectStoppedAtFiles(await deleteAccount());
  });

  it('fortæller sandt om vedhæftningerne, der allerede var væk', async () => {
    // Attachments went first and really were removed; the user is told that even
    // though the documents stage is what stopped the deletion.
    mockReleaseError = { message: 'offline' };
    expect(await deleteAccount()).toMatchObject({ filesAlreadyDeleted: true });
  });

  it('påstår ikke, at filer var væk, når der ingen var', async () => {
    mockAttachmentRows = [];
    mockReleaseError = { message: 'offline' };
    expect(await deleteAccount()).toMatchObject({ filesAlreadyDeleted: false });
  });
});

describe('et manifest, der ikke kan stoles helt på, må ikke udløse NOGEN destruktiv handling', () => {
  const OTHER_USER = '8c2d1e4f-7b3a-4c5d-9e0f-1a2b3c4d5e6f';

  it.each([
    ['en fremmed sti blandt de gyldige', [`${USER}/${A}`, `${OTHER_USER}/${B}`]],
    ['et ekstra sti-segment', [`${USER}/${A}`, `${USER}/${B}/name.pdf`]],
    ['et malformet UUID', [`${USER}/${A}`, `${USER}/not-a-uuid`]],
    ['et element der ikke er en streng', [`${USER}/${A}`, 7]],
    ['en dublet', [`${USER}/${A}`, `${USER}/${A}`]],
  ])('stopper ved files og rører ingenting ved %s', async (_label, manifest) => {
    mockServerDocumentPaths = manifest as string[];

    const result = await deleteAccount();

    // Ingen delvis oprydning: Storage bliver slet ikke bedt om noget for
    // dokumenter, heller ikke for den sti, der var gyldig.
    expect(result).toMatchObject({ ok: false, reason: 'unknown', failedAt: 'files' });
    expect(called('remove.documents')).toBe(false);

    // Og intet uigenkaldeligt: kontoen består, og telefonen ryddes ikke.
    expect(mockCalls).not.toContain('rpc.delete_my_account');
    expect(mockCalls).not.toContain('clearLocalUserData');
  });

  it('kunne ikke reddes af, at den gyldige del af listen ser rigtig ud', async () => {
    // Præcis den fælde rettelsen lukker: et filtreret manifest kan ikke skelnes
    // fra et komplet. Havde flowet slettet `${USER}/${A}` og fortsat, ville det
    // have konkluderet at oprydningen var færdig — og efterladt dét, den
    // kasserede post beskrev, i bucket'en for altid.
    mockServerDocumentPaths = [`${USER}/${A}`, `${OTHER_USER}/${B}`];
    await deleteAccount();

    expect(mockCalls.some((entry) => entry.includes(`${USER}/${A}`))).toBe(false);
    expect(mockCalls).not.toContain('rpc.delete_my_account');
  });
});

describe('RETRY: en fejlet Storage-sletning må ikke ødelægge den næste chance', () => {
  it('finder den samme sti igen og gør arbejdet færdigt på andet forsøg', async () => {
    const P = `${USER}/${A}`;
    mockServerDocumentPaths = [P];

    // --- Attempt 1: the object cannot be removed. ---
    mockDocumentRemoveResult = { error: { message: 'network' } };
    const first = await deleteAccount();

    expect(first).toMatchObject({ ok: false, reason: 'unknown', failedAt: 'files' });
    expect(mockCalls).toContain(`remove.documents:${P}`);
    expect(mockCalls).not.toContain('rpc.delete_my_account');
    expect(mockCalls).not.toContain('clearLocalUserData');

    // The account survives — and so does the only thing that knows where that
    // object is. A preparation step that deleted the metadata here would have
    // stranded the file: nothing left to rediscover it by, and the orphan sweep
    // is a backstop for exceptional loss, not a licence to create it.
    expect(mockServerDocumentPaths).toEqual([P]);

    // --- Attempt 2: same account, same path, this time the removal works. ---
    mockCalls.length = 0;
    mockDocumentRemoveResult = { error: null };
    const second = await deleteAccount();

    expect(second).toEqual({ ok: true });
    expect(mockCalls).toContain(`remove.documents:${P}`);
    expect(mockCalls).toContain('rpc.delete_my_account');

    // The release ran again and was handed the same path — that is the retry.
    const release = mockCalls.indexOf('rpc.release_my_documents_for_account_deletion');
    const remove = mockCalls.findIndex((c) => c.startsWith('remove.documents'));
    const account = mockCalls.indexOf('rpc.delete_my_account');
    expect(release).toBeLessThan(remove);
    expect(remove).toBeLessThan(account);

    // Only the account deletion takes the metadata, through the cascade.
    expect(mockServerDocumentPaths).toEqual([]);
  });

  it('overlever også en kastet Storage-fejl på første forsøg', async () => {
    const P = `${USER}/${A}`;
    mockServerDocumentPaths = [P];

    mockDocumentRemoveThrows = true;
    expect(await deleteAccount()).toMatchObject({ ok: false, failedAt: 'files' });
    expect(mockServerDocumentPaths).toEqual([P]);

    mockCalls.length = 0;
    mockDocumentRemoveThrows = false;
    expect(await deleteAccount()).toEqual({ ok: true });
    expect(mockCalls).toContain(`remove.documents:${P}`);
    expect(mockCalls).toContain('rpc.delete_my_account');
  });

  it('er idempotent: gentagne forberedelser ændrer ikke stierne', async () => {
    mockServerDocumentPaths = [`${USER}/${A}`, `${USER}/${B}`];

    mockReleaseError = { message: 'offline' };
    await deleteAccount();
    mockReleaseError = null;

    mockDocumentRemoveResult = { error: { message: 'network' } };
    await deleteAccount();
    mockDocumentRemoveResult = { error: null };

    mockCalls.length = 0;
    expect(await deleteAccount()).toEqual({ ok: true });
    expect(mockCalls).toContain(`remove.documents:${USER}/${A},${USER}/${B}`);
  });
});

describe('EXPIRY: en forladt sletning må ikke efterlade en permanent åben dør', () => {
  it('beder om frigivelse på HVERT forsøg i stedet for at stole på det forrige', async () => {
    const P = `${USER}/${A}`;
    mockServerDocumentPaths = [P];

    // --- Attempt 1: released, then the removal fails. The account survives. ---
    mockDocumentRemoveResult = { error: { message: 'network' } };
    expect(await deleteAccount()).toMatchObject({ ok: false, failedAt: 'files' });
    expect(mockCalls).toContain('rpc.release_my_documents_for_account_deletion');
    expect(mockCalls).not.toContain('rpc.delete_my_account');

    // --- Time passes and the attempt is abandoned. The server closes the
    // window on its own; nothing in the app runs to make that happen. ---
    mockServerReleaseIsCurrent = false;
    mockDocumentRemoveResult = { error: null };

    // --- Attempt 2. If the client had cached the first attempt's
    // authorization and skipped the release, the server would refuse the
    // removal and this would stop at the files stage again. ---
    mockCalls.length = 0;
    const second = await deleteAccount();

    expect(second).toEqual({ ok: true });
    expect(mockCalls).toContain('rpc.release_my_documents_for_account_deletion');
    expect(mockCalls).toContain(`remove.documents:${P}`);
    expect(mockCalls).toContain('rpc.delete_my_account');

    // The release comes first on this attempt too — it is what re-opens the
    // window, so it can never be skipped as "already done".
    expect(mockCalls.indexOf('rpc.release_my_documents_for_account_deletion'))
      .toBeLessThan(mockCalls.findIndex((c) => c.startsWith('remove.documents')));
  });

  it('beregner ikke selv udløb — der er ingen klient-timer eller udløbslogik', () => {
    // Expiry is the database's decision, measured on its own clock. The client
    // has nothing to get wrong and nothing to be lied to about.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const root = path.resolve(__dirname, '..');

    // Comments are allowed to explain the window; what must not exist is code
    // that reads, stores or counts down to it. Strip the prose, then look.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Scoped to the RELEASE window specifically. The signed-URL cache legitimately
    // tracks its own `expiresAt` in memory; that is an accepted part of the read
    // path and has nothing to do with who may delete an object.
    for (const file of ['core/documents/documentSync.ts', 'core/auth/deleteAccount.ts']) {
      const code = withoutComments(fs.readFileSync(path.join(root, file), 'utf8'));
      expect(code).not.toMatch(/account_deletion_released_at|releasedAt|release_window|releaseWindow/i);
      expect(code).not.toMatch(/setTimeout|setInterval/);
    }

    // And the window itself is one constant, in SQL.
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260925090000_private_document_bucket.sql'), 'utf8');
    expect(migration).toContain("SELECT interval '15 minutes'");
    expect(migration).toContain('now() - public.document_release_window()');
  });
});

describe('serverens bagstopper', () => {
  it('har en orphan-funktion for den nye bucket, med samme kontrakt som den gamle', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const root = path.resolve(__dirname, '..');
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260925090000_private_document_bucket.sql'), 'utf8');

    expect(migration).toContain('public.orphaned_document_paths');
    expect(migration).toContain("o.bucket_id = 'documents'");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.orphaned_document_paths\(int\) FROM public, anon, authenticated;/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.orphaned_document_paths\(int\) TO service_role;/);

    // The existing attachments sweep keeps its signature: an operational caller
    // is written against it, and widening it would break that caller in silence.
    const existing = fs.readFileSync(path.join(root, 'supabase/migrations/20260907090000_delete_my_account.sql'), 'utf8');
    expect(existing).toContain("o.bucket_id = 'attachments'");
    expect(existing).not.toContain('documents');
  });
});

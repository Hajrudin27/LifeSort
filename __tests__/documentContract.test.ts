import {
  MAX_DOCUMENT_BYTES,
  decodeDocumentRow,
  decodeDocumentRows,
  documentStoragePath,
  isDocumentSizeAccepted,
  newDocumentId,
  normalizeDocumentName,
  sortDocuments,
} from '@/core/documents/documents';
import { newEntityId } from '@/core/ids';

/**
 * APP-055 — the document contract on its own.
 *
 * The decoder is the read boundary, and a boundary that guesses is not one. Each
 * case here is a way a row could be wrong; in every one the answer has to be
 * "no row", never a partially believed row.
 */

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const OTHER_USER = '8c2d1e4f-7b3a-4c5d-9e0f-1a2b3c4d5e6f';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const validRow = () => ({
  id: DOC,
  user_id: USER,
  storage_path: `${USER}/${DOC}`,
  original_name: 'lease-agreement.pdf',
  created_at: '2026-09-25T09:00:00.000Z',
});

describe('identitet og sti', () => {
  it('bruger kryptografiske UUID\'er, ikke navne eller ure', () => {
    const first = newDocumentId();
    const second = newDocumentId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first).not.toBe(second);
    // Same primitive as every other new client entity (ADR-0025).
    expect(newEntityId()).toMatch(/^[0-9a-f]{8}-/i);
  });

  it('bygger stien som userId/documentId og intet andet', () => {
    expect(documentStoragePath(USER, DOC)).toBe(`${USER}/${DOC}`);
  });

  it('lader aldrig filnavnet forme stien', () => {
    const path = documentStoragePath(USER, DOC)!;
    for (const name of ['lease.pdf', '../../etc/passwd', 'a/b/c.pdf', 'Årsopgørelse 2026.pdf']) {
      expect(path).not.toContain(name);
      expect(path.split('/')).toHaveLength(2);
    }
    // Only two segments, so the storage policy's first-folder ownership check
    // can never be pointed at another user's prefix.
    expect(path.split('/')[0]).toBe(USER);
  });

  it('afviser alt der ikke er et UUID som sti-segment', () => {
    for (const bad of ['../escape', `${USER}/nested`, '', 'not-a-uuid', `${USER} `, `${USER}%2f..`]) {
      expect(documentStoragePath(bad, DOC)).toBeNull();
      expect(documentStoragePath(USER, bad)).toBeNull();
    }
  });
});

describe('filnavn som metadata', () => {
  it('beholder navnet brugeren kender filen på', () => {
    expect(normalizeDocumentName('Årsopgørelse 2026.pdf')).toBe('Årsopgørelse 2026.pdf');
  });

  it('afviser tomme og alt for lange navne', () => {
    for (const bad of ['', '   ', '\n\t', 'a'.repeat(256), null, undefined, 42, {}]) {
      expect(normalizeDocumentName(bad)).toBeNull();
    }
    expect(normalizeDocumentName('a'.repeat(255))).toHaveLength(255);
  });

  it('fjerner kontroltegn frem for at afvise filen', () => {
    expect(normalizeDocumentName('lease\u0000\u001b.pdf')).toBe('lease  .pdf');
  });

  it('gemmer navnet som tekst — skråstreger gør det ikke til en sti', () => {
    // The name may keep its slashes; it is never used to address an object.
    expect(normalizeDocumentName('a/b.pdf')).toBe('a/b.pdf');
    expect(documentStoragePath(USER, DOC)).not.toContain('a/b.pdf');
  });
});

describe('størrelsesgrænse', () => {
  it('matcher serverens 25 MiB-loft', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(25 * 1024 * 1024);
    expect(isDocumentSizeAccepted(MAX_DOCUMENT_BYTES)).toBe(true);
    expect(isDocumentSizeAccepted(MAX_DOCUMENT_BYTES + 1)).toBe(false);
  });

  it('afviser tomme og meningsløse størrelser, men ikke en ukendt', () => {
    expect(isDocumentSizeAccepted(0)).toBe(false);
    expect(isDocumentSizeAccepted(-1)).toBe(false);
    expect(isDocumentSizeAccepted(Number.NaN)).toBe(false);
    // Unknown is not a refusal — the bucket limit is still authoritative.
    expect(isDocumentSizeAccepted(undefined)).toBe(true);
  });
});

describe('dekoderen', () => {
  it('accepterer en komplet, sammenhængende række', () => {
    expect(decodeDocumentRow(validRow(), USER)).toEqual({
      id: DOC,
      storagePath: `${USER}/${DOC}`,
      originalName: 'lease-agreement.pdf',
      createdAt: '2026-09-25T09:00:00.000Z',
    });
  });

  it.each([
    ['malformet id', { id: 'not-a-uuid' }],
    ['malformet user_id', { user_id: 'nope' }],
    ['blankt filnavn', { original_name: '   ' }],
    ['manglende filnavn', { original_name: undefined }],
    ['ugyldig created_at', { created_at: 'i går' }],
    ['manglende created_at', { created_at: undefined }],
    ['numerisk created_at', { created_at: 1758790800000 }],
    ['sti der ikke stammer fra rækken', { storage_path: `${USER}/something-else` }],
    ['sti med filnavn', { storage_path: `${USER}/${DOC}/lease.pdf` }],
    ['sti mod en anden bruger', { storage_path: `${OTHER_USER}/${DOC}` }],
    ['manglende sti', { storage_path: undefined }],
  ])('afviser %s fail-closed', (_label, override) => {
    expect(decodeDocumentRow({ ...validRow(), ...override }, USER)).toBeNull();
  });

  it('afviser en anden brugers række, selv hvis den er velformet', () => {
    const foreign = { ...validRow(), user_id: OTHER_USER, storage_path: `${OTHER_USER}/${DOC}` };
    expect(decodeDocumentRow(foreign, USER)).toBeNull();
    // And it is not rescued by decoding it as its real owner elsewhere in a list.
    expect(decodeDocumentRows([validRow(), foreign], USER)).toHaveLength(1);
  });

  it('afviser ikke-objekter og ukendte former', () => {
    for (const bad of [null, undefined, 'row', 42, [], [validRow()]]) {
      expect(decodeDocumentRow(bad, USER)).toBeNull();
    }
    expect(decodeDocumentRow(validRow(), 'not-a-uuid')).toBeNull();
  });

  it('forfremmer aldrig en URL til identitet', () => {
    const withUrl = { ...validRow(), signed_url: 'https://storage.example/signed', url: 'https://x' };
    const decoded = decodeDocumentRow(withUrl, USER);
    expect(decoded).not.toBeNull();
    expect(JSON.stringify(decoded)).not.toContain('https://');
    expect(Object.keys(decoded!)).toEqual(['id', 'storagePath', 'originalName', 'createdAt']);
  });

  it('dropper den dårlige række og beholder resten', () => {
    const good = validRow();
    const decoded = decodeDocumentRows([good, { id: 'bad' }, null, { ...good, original_name: '' }], USER);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].id).toBe(DOC);
  });
});

describe('rækkefølge', () => {
  it('er nyeste først og deterministisk ved samme tidspunkt', () => {
    const at = (id: string, createdAt: string) => ({
      id, storagePath: `${USER}/${id}`, originalName: 'x.pdf', createdAt,
    });
    const a = at('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '2026-09-01T00:00:00.000Z');
    const b = at('b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '2026-09-25T00:00:00.000Z');
    const c = at('c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '2026-09-25T00:00:00.000Z');
    expect(sortDocuments([a, c, b]).map((d) => d.id)).toEqual([b.id, c.id, a.id]);
    expect(sortDocuments([c, b, a]).map((d) => d.id)).toEqual([b.id, c.id, a.id]);
  });
});

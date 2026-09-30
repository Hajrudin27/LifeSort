/**
 * APP-058 — moving one legacy on-device trip file into Documents.
 *
 * Nothing is lost: the legacy copy is removed only after the upload AND the link have
 * both succeeded, the encrypted bytes are never sent to the uploader, the temporary
 * plaintext copy is always deleted, and a retry after a failed link does not upload a
 * second copy.
 */

jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn() } } }));
jest.mock('@/core/documents/documentSync', () => ({ uploadDocument: jest.fn() }));
jest.mock('@/utils/shared/attachmentSync', () => ({ resolveAttachmentUri: jest.fn() }));
jest.mock('@/utils/trip/tripRemote', () => ({ linkTripDocument: jest.fn() }));

import {
  clearLegacyTripDocumentProgress,
  moveLegacyTripDocumentToDocuments,
  type LegacyTripDocumentDeps,
} from '@/utils/trip/legacyTripDocuments';
import type { Attachment } from '@/types/attachment';

const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ENCRYPTED = 'file:///doc/attachments/att-1.lsenc';
const TEMP_PLAINTEXT = 'file:///cache/lifesort-decrypted-attachments/att-1-boarding-pass.pdf';

// The real module computes these from FileSystem.cacheDirectory / documentDirectory, which the
// jest-expo environment leaves undefined; the fakes below use the same URI shapes.
jest.mock('@/core/storage/documentCacheStorage', () => ({
  isEncryptedAttachmentCacheUri: (uri: string) => uri.startsWith('file:///doc/attachments/') && uri.endsWith('.lsenc'),
  isTemporaryDecryptedAttachmentUri: (uri: string) => uri.startsWith('file:///cache/lifesort-decrypted-attachments/'),
  deleteCachedAttachmentFile: jest.fn(),
}));

const attachment: Attachment = { id: 'att-1', uri: ENCRYPTED, name: 'boarding-pass.pdf', kind: 'document' };

function deps(overrides: Partial<LegacyTripDocumentDeps> = {}) {
  const events: string[] = [];
  const value: LegacyTripDocumentDeps = {
    resolveUri: jest.fn(async () => { events.push('resolve'); return TEMP_PLAINTEXT; }),
    upload: jest.fn(async () => { events.push('upload'); return { ok: true as const, document: { id: DOC, storagePath: 'u/d', originalName: 'boarding-pass.pdf', createdAt: '2026-09-30T00:00:00Z' } }; }),
    link: jest.fn(async () => { events.push('link'); return 'linked' as const; }),
    cleanupTemporary: jest.fn(async () => { events.push('cleanup'); }),
    ...overrides,
  };
  return { value, events };
}

const move = (d: LegacyTripDocumentDeps, removeLegacy = jest.fn()) =>
  moveLegacyTripDocumentToDocuments('trip-1', attachment, removeLegacy, d).then((result) => ({ result, removeLegacy }));

beforeEach(() => clearLegacyTripDocumentProgress());

describe('APP-058 explicit legacy file move', () => {
  it('resolves, uploads the PLAINTEXT copy, links, and only then removes the legacy copy — then cleans up', async () => {
    const { value, events } = deps();
    const removeLegacy = jest.fn(() => events.push('remove-legacy'));
    const { result } = await move(value, removeLegacy);

    expect(result).toEqual({ ok: true, documentId: DOC });
    expect(events).toEqual(['resolve', 'upload', 'cleanup', 'link', 'remove-legacy']);
    expect(value.upload).toHaveBeenCalledWith({ uri: TEMP_PLAINTEXT, name: 'boarding-pass.pdf' });
    expect(value.link).toHaveBeenCalledWith('trip-1', DOC);
    expect(value.cleanupTemporary).toHaveBeenCalledWith(TEMP_PLAINTEXT);
    expect(removeLegacy).toHaveBeenCalledTimes(1);
  });

  it('never hands encrypted .lsenc bytes to the uploader', async () => {
    const { value } = deps({ resolveUri: jest.fn(async () => ENCRYPTED) });
    const { result, removeLegacy } = await move(value);
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
    expect(value.upload).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it.each([
    ['resolves to nothing', jest.fn(async () => null)],
    ['throws while decrypting', jest.fn(async () => { throw new Error('key gone'); })],
  ])('keeps the legacy copy when the file %s', async (_label: string, resolveUri: jest.Mock) => {
    const { value } = deps({ resolveUri });
    const { result, removeLegacy } = await move(value);
    expect(result).toEqual({ ok: false, reason: 'unreadable' });
    expect(value.upload).not.toHaveBeenCalled();
    expect(value.link).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
  });

  it.each([
    ['is refused', jest.fn(async () => ({ ok: false as const, reason: 'upload-failed' as const }))],
    ['throws', jest.fn(async () => { throw new Error('offline'); })],
  ])('keeps the legacy copy, links nothing, and cleans up when the upload %s', async (_label: string, upload: jest.Mock) => {
    const { value } = deps({ upload });
    const { result, removeLegacy } = await move(value);
    expect(result).toEqual({ ok: false, reason: 'upload-failed' });
    expect(value.link).not.toHaveBeenCalled();
    expect(removeLegacy).not.toHaveBeenCalled();
    expect(value.cleanupTemporary).toHaveBeenCalledWith(TEMP_PLAINTEXT);
  });

  it('keeps the legacy copy when the link fails, and says so — the uploaded document is not pretended away', async () => {
    const { value } = deps({ link: jest.fn(async () => 'failed' as const) });
    const { result, removeLegacy } = await move(value);
    expect(result).toEqual({ ok: false, reason: 'link-failed' });
    expect(removeLegacy).not.toHaveBeenCalled();
    // The temporary plaintext is gone even though the flow did not finish.
    expect(value.cleanupTemporary).toHaveBeenCalledWith(TEMP_PLAINTEXT);
  });

  it('a retry after a failed link only links: no second upload, no second decryption', async () => {
    const first = deps({ link: jest.fn(async () => 'failed' as const) });
    await move(first.value);

    const retry = deps();
    const removeLegacy = jest.fn();
    const { result } = await move(retry.value, removeLegacy);

    expect(result).toEqual({ ok: true, documentId: DOC });
    expect(retry.value.resolveUri).not.toHaveBeenCalled();
    expect(retry.value.upload).not.toHaveBeenCalled();
    expect(retry.value.link).toHaveBeenCalledWith('trip-1', DOC);
    expect(removeLegacy).toHaveBeenCalledTimes(1);
  });

  it('treats an already-existing link as success, and a finished move cannot be repeated by mistake', async () => {
    const { value } = deps({ link: jest.fn(async () => 'already-linked' as const) });
    const { result, removeLegacy } = await move(value);
    expect(result).toEqual({ ok: true, documentId: DOC });
    expect(removeLegacy).toHaveBeenCalledTimes(1);

    // Progress was cleared on success: a second call starts from resolve again.
    const again = deps();
    await move(again.value);
    expect(again.value.resolveUri).toHaveBeenCalledTimes(1);
  });

  it('refuses a second tap while one move is running, and never uploads twice', async () => {
    let finishUpload!: () => void;
    const { value } = deps({
      upload: jest.fn(() => new Promise((resolve) => {
        finishUpload = () => resolve({ ok: true as const, document: { id: DOC, storagePath: 'u/d', originalName: 'x', createdAt: 'x' } });
      })),
    });
    const removeLegacy = jest.fn();
    const first = moveLegacyTripDocumentToDocuments('trip-1', attachment, removeLegacy, value);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await expect(moveLegacyTripDocumentToDocuments('trip-1', attachment, removeLegacy, value)).resolves.toEqual({ ok: false, reason: 'busy' });
    finishUpload();
    await expect(first).resolves.toEqual({ ok: true, documentId: DOC });
    expect(value.upload).toHaveBeenCalledTimes(1);
    expect(removeLegacy).toHaveBeenCalledTimes(1);
  });

  it('a failing temporary cleanup never fails or undoes a good move', async () => {
    const { value } = deps({ cleanupTemporary: jest.fn(async () => { throw new Error('disk'); }) });
    const { result, removeLegacy } = await move(value);
    expect(result).toEqual({ ok: true, documentId: DOC });
    expect(removeLegacy).toHaveBeenCalledTimes(1);
  });

});

describe('APP-058 production defaults', () => {
  const { uploadDocument } = jest.requireMock('@/core/documents/documentSync');
  const { resolveAttachmentUri } = jest.requireMock('@/utils/shared/attachmentSync');
  const { linkTripDocument } = jest.requireMock('@/utils/trip/tripRemote');
  const { deleteCachedAttachmentFile } = jest.requireMock('@/core/storage/documentCacheStorage');
  const okUpload = { ok: true, document: { id: DOC, storagePath: 'u/d', originalName: 'x', createdAt: 'x' } };

  beforeEach(() => {
    jest.clearAllMocks();
    uploadDocument.mockResolvedValue(okUpload);
    linkTripDocument.mockResolvedValue('linked');
  });

  it('deletes the temporary decrypted copy, and only that', async () => {
    resolveAttachmentUri.mockResolvedValue(TEMP_PLAINTEXT);
    const removeLegacy = jest.fn();
    await expect(moveLegacyTripDocumentToDocuments('trip-1', attachment, removeLegacy)).resolves.toEqual({ ok: true, documentId: DOC });
    expect(uploadDocument).toHaveBeenCalledWith({ uri: TEMP_PLAINTEXT, name: 'boarding-pass.pdf' });
    expect(deleteCachedAttachmentFile).toHaveBeenCalledTimes(1);
    expect(deleteCachedAttachmentFile).toHaveBeenCalledWith(TEMP_PLAINTEXT);
  });

  it('never deletes a plaintext legacy file the resolver returned as it was: that is the only copy', async () => {
    resolveAttachmentUri.mockResolvedValue('file:///doc/attachments/att-1.pdf');
    await moveLegacyTripDocumentToDocuments('trip-1', attachment, jest.fn());
    expect(deleteCachedAttachmentFile).not.toHaveBeenCalled();
  });

  it('cleans the temporary copy even when the upload throws', async () => {
    resolveAttachmentUri.mockResolvedValue(TEMP_PLAINTEXT);
    uploadDocument.mockRejectedValue(new Error('offline'));
    await expect(moveLegacyTripDocumentToDocuments('trip-1', attachment, jest.fn())).resolves.toEqual({ ok: false, reason: 'upload-failed' });
    expect(deleteCachedAttachmentFile).toHaveBeenCalledWith(TEMP_PLAINTEXT);
  });
});

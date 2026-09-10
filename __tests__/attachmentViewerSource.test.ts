import {
  clearAttachmentViewerSources,
  consumeAttachmentViewerSource,
  registerAttachmentViewerSource,
} from '@/utils/shared/attachmentViewerSource';

const source = {
  id: 'legacy-attachment',
  uri: 'file:///doc/attachments/photo.lsenc',
  name: 'private-photo.jpg',
  kind: 'image' as const,
  storagePath: 'user/warranty/owner/photo.jpg',
};

beforeEach(() => clearAttachmentViewerSources());
afterEach(() => clearAttachmentViewerSources());

describe('APP-029 attachment viewer handoffs', () => {
  it.each([1, 3])('clears all %i pending sources synchronously', (count) => {
    const ids = Array.from({ length: count }, (_, index) =>
      registerAttachmentViewerSource({ ...source, id: `attachment-${index}` }),
    );

    expect(clearAttachmentViewerSources()).toBeUndefined();

    for (const id of ids) expect(consumeAttachmentViewerSource(id)).toBeNull();
  });

  it('registers and consumes a source exactly once, including after cleanup', () => {
    const firstId = registerAttachmentViewerSource(source);
    expect(consumeAttachmentViewerSource(firstId)).toEqual(source);
    expect(consumeAttachmentViewerSource(firstId)).toBeNull();

    clearAttachmentViewerSources();
    const nextId = registerAttachmentViewerSource(source);
    expect(consumeAttachmentViewerSource(nextId)).toEqual(source);
    expect(consumeAttachmentViewerSource(nextId)).toBeNull();
  });

  it('safely clears an already empty map repeatedly', () => {
    expect(() => {
      clearAttachmentViewerSources();
      clearAttachmentViewerSources();
    }).not.toThrow();
    expect(consumeAttachmentViewerSource('missing')).toBeNull();
    expect(consumeAttachmentViewerSource(undefined)).toBeNull();
  });
});

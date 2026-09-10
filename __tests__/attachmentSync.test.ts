import { newEntityId } from '@/core/ids';
import { uploadAttachment } from '@/utils/shared/attachmentSync';
import {
  deleteCachedAttachmentFile,
  isTemporaryDecryptedAttachmentUri,
  resolveLocalAttachmentUri,
} from '@/core/storage/documentCacheStorage';

const mockUpload = jest.fn(() => Promise.resolve({ error: null }));
const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user_1' } } })),
    },
    storage: {
      from: jest.fn(() => ({
        upload: mockUpload,
        createSignedUrl: jest.fn(() => Promise.resolve({ data: { signedUrl: 'https://storage.example/signed' } })),
      })),
    },
    from: jest.fn(() => ({
      upsert: mockUpsert,
      delete: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })) })),
      select: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: [], error: null })) })) })),
    })),
  },
}));

jest.mock('@/core/storage/documentCacheStorage', () => ({
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
  isTemporaryDecryptedAttachmentUri: jest.fn((uri: string) =>
    uri.startsWith('file:///cache/lifesort-decrypted-attachments/'),
  ),
  resolveLocalAttachmentUri: jest.fn(),
}));

const mockResolveLocalAttachmentUri = resolveLocalAttachmentUri as jest.MockedFunction<typeof resolveLocalAttachmentUri>;
const mockDeleteCachedAttachmentFile = deleteCachedAttachmentFile as jest.MockedFunction<typeof deleteCachedAttachmentFile>;

describe('attachment upload temp ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveLocalAttachmentUri.mockResolvedValue('file:///cache/lifesort-decrypted-attachments/upload.jpg');
    global.fetch = jest.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(['bytes'])) })) as jest.Mock;
  });

  it('cleans upload-created temporary plaintext files in finally', async () => {
    await uploadAttachment('expense', 'owner_1', {
      id: 'attachment_1',
      uri: 'file:///doc/attachments/image.lsenc',
      name: 'image.jpg',
      kind: 'image',
    });

    expect(mockResolveLocalAttachmentUri).toHaveBeenCalledWith('file:///doc/attachments/image.lsenc', 'image.jpg');
    expect(isTemporaryDecryptedAttachmentUri).toHaveBeenCalledWith('file:///cache/lifesort-decrypted-attachments/upload.jpg');
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith('file:///cache/lifesort-decrypted-attachments/upload.jpg');
    expect(mockUpload).toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalled();
  });

  it.each(['expense', 'warranty'] as const)('accepts UUID %s paths and preserves entity/owner references in uploaded metadata', async (ownerType) => {
    const ownerId = newEntityId();
    const id = newEntityId();
    const result = await uploadAttachment(ownerType, ownerId, {
      id, uri: 'file:///doc/attachments/image.lsenc', name: 'image.jpg', kind: 'image',
    });
    const storagePath = `user_1/${ownerType}/${ownerId}/${id}.jpg`;
    expect(result).toEqual({ storagePath });
    expect(mockUpload).toHaveBeenCalledWith(storagePath, expect.any(Blob), expect.any(Object));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ id, owner_id: ownerId, storage_path: storagePath }));
  });

  it.each(['../escape', 'folder/id', 'id.with.dots', 'id\\escape', '%2e%2e'])('still rejects unsafe ID segments: %s', async (unsafe) => {
    for (const [ownerId, id] of [[unsafe, newEntityId()], [newEntityId(), unsafe]]) {
      await expect(uploadAttachment('expense', ownerId, {
        id, uri: 'file:///doc/attachments/image.lsenc', name: 'image.jpg', kind: 'image',
      })).resolves.toBeNull();
    }
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('still accepts legacy timestamp-shaped owner and attachment IDs', async () => {
    await expect(uploadAttachment('expense', '1725206400000', {
      id: '1725206400001', uri: 'file:///doc/attachments/old.lsenc', name: 'old.pdf', kind: 'document',
    })).resolves.toEqual({ storagePath: 'user_1/expense/1725206400000/1725206400001.pdf' });
  });
});

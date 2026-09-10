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
});

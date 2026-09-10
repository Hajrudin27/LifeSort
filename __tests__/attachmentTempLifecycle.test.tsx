import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import * as entityIds from '@/core/ids';
import { persistFile } from '@/utils/shared/attachmentStorage';
import AttachmentList from '@/components/AttachmentList';
import TripAttachmentGrid from '@/components/TripAttachmentGrid';
import ViewImageScreen from '@/app/warranties/view-image';
import { useAttachmentUri } from '@/hooks/useAttachmentUri';
import { registerAttachmentViewerSource } from '@/utils/shared/attachmentViewerSource';
import { Attachment } from '@/types/attachment';
import { TripAttachment } from '@/types/trip';
import { resolveAttachmentUri } from '@/utils/shared/attachmentSync';
import {
  deleteCachedAttachmentFile,
  isTemporaryDecryptedAttachmentUri,
} from '@/core/storage/documentCacheStorage';
import * as Sharing from 'expo-sharing';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/hooks/useAccentTints', () => ({
  useAccentTints: () => ({
    accent: '#0057D9',
    accentSoft: '#DDE8FF',
  }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/useSensitiveAction', () => ({
  useSensitiveAction: () => ({
    run: (action: () => Promise<void> | void) => Promise.resolve(action()),
    prompt: null,
  }),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  const mockRouterPush = jest.fn();
  const mockUseLocalSearchParams = jest.fn(() => ({}));
  return {
    __mockRouterPush: mockRouterPush,
    __mockUseLocalSearchParams: mockUseLocalSearchParams,
    router: { push: mockRouterPush },
    useLocalSearchParams: mockUseLocalSearchParams,
    Stack: {
      Screen: (props: Record<string, unknown>) => React.createElement('Stack.Screen', props),
    },
  };
});

jest.mock('expo-image', () => {
  const React = require('react');
  return {
    Image: (props: Record<string, unknown>) => React.createElement('Image', props),
  };
});

jest.mock('expo-symbols', () => {
  const React = require('react');
  return {
    SymbolView: (props: Record<string, unknown>) => React.createElement('SymbolView', props),
  };
});

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/utils/shared/imageCompression', () => ({
  compressImage: jest.fn((uri: string) => Promise.resolve({ uri })),
}));

jest.mock('@/utils/shared/attachmentStorage', () => ({
  persistFile: jest.fn((uri: string) => Promise.resolve(uri)),
}));

jest.mock('@/utils/shared/attachmentSync', () => ({
  resolveAttachmentUri: jest.fn(),
}));

jest.mock('@/core/storage/documentCacheStorage', () => ({
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
  isTemporaryDecryptedAttachmentUri: jest.fn((uri: string) =>
    uri.startsWith('file:///cache/lifesort-decrypted-attachments/'),
  ),
}));

const mockResolveAttachmentUri = resolveAttachmentUri as jest.MockedFunction<typeof resolveAttachmentUri>;
const mockDeleteCachedAttachmentFile = deleteCachedAttachmentFile as jest.MockedFunction<typeof deleteCachedAttachmentFile>;
const mockIsTemporaryDecryptedAttachmentUri = isTemporaryDecryptedAttachmentUri as jest.MockedFunction<
  typeof isTemporaryDecryptedAttachmentUri
>;
const mockRouterPush = jest.requireMock('expo-router').__mockRouterPush as jest.Mock;
const mockUseLocalSearchParams = jest.requireMock('expo-router').__mockUseLocalSearchParams as jest.Mock;
const mockShareAsync = Sharing.shareAsync as jest.MockedFunction<typeof Sharing.shareAsync>;
const mockSharingAvailable = Sharing.isAvailableAsync as jest.MockedFunction<typeof Sharing.isAvailableAsync>;

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function HookProbe({
  attachment,
  enabled = true,
  onUri,
}: {
  attachment: Attachment | TripAttachment;
  enabled?: boolean;
  onUri: (uri: string | null) => void;
}) {
  const uri = useAttachmentUri(attachment, { enabled });
  useEffect(() => {
    onUri(uri);
  }, [onUri, uri]);
  return null;
}

function openAttachmentButtons(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => node.props.accessibilityLabel === 'common.a11y.openAttachment');
}

const imageAttachment = {
  id: 'image-1',
  uri: 'file:///doc/attachments/image.lsenc',
  storagePath: 'user/warranty/owner/image.jpg',
  name: 'image.jpg',
  kind: 'image',
} satisfies Attachment;

const documentAttachment: Attachment = {
  id: 'doc-1',
  uri: 'file:///doc/attachments/doc.lsenc',
  storagePath: 'user/warranty/owner/doc.pdf',
  name: 'doc.pdf',
  kind: 'document',
};

const tripDocument: TripAttachment = {
  id: 'trip-doc-1',
  uri: 'file:///doc/attachments/trip-doc.lsenc',
  name: 'boarding-pass.pdf',
  kind: 'document',
};

describe('APP-029 temporary plaintext attachment lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockResolveAttachmentUri.mockResolvedValue(null);
    mockSharingAvailable.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('cleans a hook-created temporary URI on unmount', async () => {
    const onUri = jest.fn();
    const tempUri = 'file:///cache/lifesort-decrypted-attachments/thumb.jpg';
    mockResolveAttachmentUri.mockResolvedValueOnce(tempUri);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HookProbe attachment={imageAttachment} onUri={onUri} />);
    });
    await flushPromises();

    expect(onUri).toHaveBeenLastCalledWith(tempUri);

    await act(async () => {
      renderer.unmount();
    });

    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(tempUri);
  });

  it('cleans the old hook-created temporary URI when attachment fields change', async () => {
    const firstTempUri = 'file:///cache/lifesort-decrypted-attachments/first.jpg';
    const secondTempUri = 'file:///cache/lifesort-decrypted-attachments/second.jpg';
    mockResolveAttachmentUri.mockResolvedValueOnce(firstTempUri).mockResolvedValueOnce(secondTempUri);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HookProbe attachment={imageAttachment} onUri={jest.fn()} />);
    });
    await flushPromises();

    await act(async () => {
      renderer.update(
        <HookProbe
          attachment={{ ...imageAttachment, name: 'renamed.png' }}
          onUri={jest.fn()}
        />,
      );
    });
    await flushPromises();

    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(firstTempUri);

    await act(async () => {
      renderer.unmount();
    });

    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(secondTempUri);
  });

  it('deletes a temporary URI if resolution completes after unmount', async () => {
    const pending = defer<string | null>();
    const tempUri = 'file:///cache/lifesort-decrypted-attachments/late.jpg';
    mockResolveAttachmentUri.mockReturnValueOnce(pending.promise);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HookProbe attachment={imageAttachment} onUri={jest.fn()} />);
    });

    await act(async () => {
      renderer.unmount();
    });
    await act(async () => {
      pending.resolve(tempUri);
      await pending.promise;
    });

    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(tempUri);
  });

  it('does not pass remote signed URLs to local temp cleanup', async () => {
    const remoteUrl = 'https://storage.example/signed-url';
    mockResolveAttachmentUri.mockResolvedValueOnce(remoteUrl);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HookProbe attachment={imageAttachment} onUri={jest.fn()} />);
    });
    await flushPromises();
    await act(async () => {
      renderer.unmount();
    });

    expect(mockIsTemporaryDecryptedAttachmentUri).toHaveBeenCalledWith(remoteUrl);
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalled();
  });

  it('does not resolve/decrypt document thumbnails', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AttachmentList attachments={[documentAttachment]} onAdd={jest.fn()} onRemove={jest.fn()} />,
      );
    });
    await flushPromises();

    expect(mockResolveAttachmentUri).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  it('still resolves image thumbnails and does not pass thumbnail temp URI to fullscreen', async () => {
    const thumbTempUri = 'file:///cache/lifesort-decrypted-attachments/thumb-owned.jpg';
    mockResolveAttachmentUri.mockResolvedValueOnce(thumbTempUri);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AttachmentList attachments={[imageAttachment]} onAdd={jest.fn()} onRemove={jest.fn()} />,
      );
    });
    await flushPromises();

    expect(mockResolveAttachmentUri).toHaveBeenCalledWith(imageAttachment);

    const thumb = openAttachmentButtons(renderer)[0];
    await act(async () => {
      thumb.props.onPress();
    });

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/warranties/view-image',
      params: { sourceId: expect.any(String) },
    });
    expect(mockRouterPush.mock.calls[0][0].params).not.toHaveProperty('uri');

    await act(async () => {
      renderer.unmount();
    });

    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(thumbTempUri);
  });

  it('fullscreen local encrypted images resolve their own temp lifecycle', async () => {
    const thumbnailTempUri = 'file:///cache/lifesort-decrypted-attachments/thumbnail-owned.jpg';
    const viewerTempUri = 'file:///cache/lifesort-decrypted-attachments/viewer-owned.jpg';
    const sourceId = registerAttachmentViewerSource(imageAttachment);
    mockUseLocalSearchParams.mockReturnValue({ sourceId });
    mockResolveAttachmentUri.mockResolvedValueOnce(viewerTempUri);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ViewImageScreen />);
    });
    await flushPromises();

    expect(mockResolveAttachmentUri).toHaveBeenCalledWith(
      expect.objectContaining({
        id: imageAttachment.id,
        uri: imageAttachment.uri,
        name: imageAttachment.name,
        kind: 'image',
        storagePath: imageAttachment.storagePath,
      }),
    );

    await act(async () => {
      renderer.unmount();
    });

    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(viewerTempUri);
    expect(mockDeleteCachedAttachmentFile).not.toHaveBeenCalledWith(thumbnailTempUri);
  });

  it('trip document share resolves on demand and cleans its temporary URI', async () => {
    const docTempUri = 'file:///cache/lifesort-decrypted-attachments/share.pdf';

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <TripAttachmentGrid attachments={[tripDocument]} onAdd={jest.fn()} onRemove={jest.fn()} />,
      );
    });
    await flushPromises();

    expect(mockResolveAttachmentUri).not.toHaveBeenCalled();
    mockResolveAttachmentUri.mockResolvedValueOnce(docTempUri);

    const thumb = openAttachmentButtons(renderer)[0];
    await act(async () => {
      await thumb.props.onPress();
    });

    expect(mockResolveAttachmentUri).toHaveBeenCalledTimes(1);
    expect(mockResolveAttachmentUri).toHaveBeenCalledWith(tripDocument);
    expect(mockShareAsync).toHaveBeenCalledWith(docTempUri);
    expect(mockDeleteCachedAttachmentFile).toHaveBeenCalledWith(docTempUri);

    await act(async () => {
      renderer.unmount();
    });
  });
});


describe('APP-030 attachment entity creation', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['camera', 0],
    ['library', 1],
    ['document', 2],
  ] as const)('trip %s does not persist a file when entity UUID generation fails', async (_source, actionIndex) => {
    const pick = { canceled: false, assets: [{ uri: 'file:///picked.jpg', fileName: 'photo.jpg', name: 'document.pdf' }] };
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue(pick);
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue(pick);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue(pick);
    const onAdd = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TripAttachmentGrid attachments={[]} onAdd={onAdd} onRemove={jest.fn()} />);
    });
    const actions = [...new Set(renderer.root.findAll((node) =>
      node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function',
    ).map((node) => node.props.onPress as () => Promise<void>))];
    const failure = new Error('secure UUID generation unavailable');
    const generateId = jest.spyOn(entityIds, 'newEntityId').mockImplementationOnce(() => { throw failure; });
    try {
      expect(actions).toHaveLength(3);
      await act(async () => {
        await expect(actions[actionIndex]()).rejects.toThrow(failure);
      });
      expect(generateId).toHaveBeenCalledTimes(1);
      expect(persistFile).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();
    } finally {
      generateId.mockRestore();
      await act(async () => { renderer.unmount(); });
    }
  });

  it.each(['list', 'trip'] as const)('%s camera, library and document actions create distinct UUID v4 IDs', async (kind) => {
    const pick = { canceled: false, assets: [{ uri: 'file:///picked.jpg', fileName: 'photo.jpg', name: 'document.pdf', width: 10, height: 10 }] };
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue(pick);
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue(pick);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue(pick);
    const onAdd = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(kind === 'list'
        ? <AttachmentList attachments={[]} onAdd={onAdd} onRemove={jest.fn()} />
        : <TripAttachmentGrid attachments={[]} onAdd={onAdd} onRemove={jest.fn()} />);
    });
    const actions = [...new Set(renderer.root.findAll((node) =>
      node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function',
    ).map((node) => node.props.onPress as () => Promise<void>))];
    expect(actions).toHaveLength(3);
    // Repeat without advancing time: a timestamp-only generator would collide.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(123);
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        for (const action of actions) await act(async () => { await action(); });
      }
      const attachments = onAdd.mock.calls.map(([attachment]) => attachment);
      expect(attachments).toHaveLength(6);
      expect(persistFile).toHaveBeenCalledTimes(6);
      expect(attachments.every((a) => a.uri === 'file:///picked.jpg')).toBe(true);
      expect(attachments.map((a) => a.kind)).toEqual(['image', 'image', 'document', 'image', 'image', 'document']);
      expect(attachments.every((a) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.id))).toBe(true);
      expect(new Set(attachments.map((a) => a.id)).size).toBe(6);
    } finally {
      clock.mockRestore();
      await act(async () => { renderer.unmount(); });
    }
  });
});

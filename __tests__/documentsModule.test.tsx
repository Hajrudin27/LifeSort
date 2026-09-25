import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Linking } from 'react-native';

import DocumentsScreen from '@/app/documents/index';
import { PUBLIC_VIEWER, evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import { MODULE_IDS, getModule, moduleAccess } from '@/core/modules/moduleRegistry';
import { moduleForPath } from '@/core/modules/moduleRoutes';
import { canToggleModule } from '@/core/modules/moduleEnablement';
import i18n from '@/localization/i18n';
import { useDocumentsStore } from '@/store/useDocumentsStore';

/**
 * APP-055 — the module's maturity and the smallest screen that makes it real.
 *
 * `internal` is the load-bearing assertion. A domain a user can put a document
 * into but not take one out of is not finished, and the launcher, the routes and
 * the gate all have to agree about that from one place.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/core/documents/documentSync', () => ({
  cleanupTemporaryPickerFile: jest.fn(() => Promise.resolve()),
  documentReadUrl: jest.fn(() => Promise.resolve('https://storage.example/signed-1')),
  fetchDocuments: jest.fn(() => Promise.resolve([])),
  uploadDocument: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));

import { cleanupTemporaryPickerFile, documentReadUrl, fetchDocuments, uploadDocument } from '@/core/documents/documentSync';

const mockPick = DocumentPicker.getDocumentAsync as jest.Mock;
const mockUploadDocument = uploadDocument as jest.Mock;
const mockFetchDocuments = fetchDocuments as jest.Mock;
const mockDocumentReadUrl = documentReadUrl as jest.Mock;

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const document = {
  id: DOC,
  storagePath: `${USER}/${DOC}`,
  originalName: 'lease-agreement.pdf',
  createdAt: '2026-09-25T09:00:00.000Z',
};

describe('modulets plads i registret', () => {
  it('findes som documents med document-sensitivity og ejer /documents', () => {
    expect(MODULE_IDS).toContain('documents');
    const definition = getModule('documents');
    expect(definition.sensitivity).toEqual(['document']);
    expect(definition.routeRoots).toEqual(['/documents']);
    expect(moduleForPath('/documents')).toBe('documents');
    expect(moduleForPath('/documents/whatever')).toBe('documents');
  });

  it('er internal — APP-056 mangler stadig sletningen', () => {
    expect(getModule('documents').availability).toBe('internal');
  });

  it('er usynligt for en almindelig bruger, men data er stadig hendes', () => {
    const access = moduleAccess('documents', PUBLIC_VIEWER);
    expect(access).toEqual(evaluateModuleAccess('internal', PUBLIC_VIEWER));
    expect(access.showInNavigation).toBe(false);
    expect(access.canOpenModule).toBe(false);
    expect(access.status).toBe('internal-only');
    // ADR-0004: a maturity state never takes away a data right.
    expect(access.canExportData).toBe(true);
    expect(access.canDeleteData).toBe(true);
  });

  it('åbner for en intern bruger, så modulet kan afprøves', () => {
    const access = moduleAccess('documents', { isInternalUser: true, isBetaTester: false });
    expect(access.canOpenModule).toBe(true);
    expect(access.status).toBe('active');
  });

  it('kan fravælges som ethvert andet ikke-platform-modul', () => {
    expect(canToggleModule('documents')).toBe(true);
  });

  it('har navn og beskrivelse på både dansk og engelsk', () => {
    const definition = getModule('documents');
    for (const language of ['da', 'en']) {
      for (const key of [definition.titleKey, definition.descriptionKey]) {
        const value = i18n.getFixedT(language)(key);
        expect(typeof value).toBe('string');
        expect(value).not.toBe(key);
        expect(value.trim()).not.toBe('');
      }
    }
  });
});

describe('skærmen', () => {
  let tree: TestRenderer.ReactTestRenderer;
  const texts = () => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join('')).join(' | ');
  const buttons = () =>
    tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
  const labels = () => buttons().map((n) => String(n.props.accessibilityLabel ?? '')).filter(Boolean);
  const button = (match: (label: string) => boolean) =>
    buttons().find((n) => match(String(n.props.accessibilityLabel ?? '')))!;

  // The screen refreshes from the server on mount, so the seed goes through the
  // fetch the way it does in the app rather than being injected behind it.
  const render = async (documents: (typeof document)[] = []) => {
    mockFetchDocuments.mockResolvedValue(documents);
    useDocumentsStore.setState({ documents, uploading: false, uploadError: null });
    await act(async () => { tree = TestRenderer.create(<DocumentsScreen />); });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFetchDocuments.mockResolvedValue([]);
    mockDocumentReadUrl.mockResolvedValue('https://storage.example/signed-1');
    useDocumentsStore.setState({ documents: [], uploading: false, uploadError: null });
    await i18n.changeLanguage('da');
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  });

  afterEach(() => { act(() => { tree?.unmount(); }); });

  it.each(['da', 'en'])('viser filnavn og dato — og aldrig sti, URL eller bruger-id — på %s', async (language) => {
    await act(async () => { await i18n.changeLanguage(language); });
    await render([document]);

    const rendered = texts();
    expect(rendered).toContain('lease-agreement.pdf');
    expect(rendered).toMatch(/2026/);
    expect(rendered).not.toBe('');

    for (const secret of [document.storagePath, USER, DOC, 'https://storage.example/signed-1', 'file://']) {
      expect(rendered).not.toContain(secret);
      expect(labels().join(' ')).not.toContain(secret);
    }
  });

  it('giver upload og hver række en knap-rolle og en læsbar etiket', async () => {
    await render([document]);

    expect(buttons().length).toBeGreaterThanOrEqual(2);
    // The row label carries both facts, because the icon and the muted date line
    // are not announced on their own.
    expect(labels().some((label) => label.includes('lease-agreement.pdf') && label.includes('2026'))).toBe(true);
    expect(labels()).toContain(i18n.t('documents.upload'));
  });

  it('har ingen slet-handling — APP-056 ejer sletningen', async () => {
    await render([document]);
    const all = `${texts()} ${labels().join(' ')}`.toLowerCase();
    for (const word of ['slet', 'delete', 'fjern', 'remove']) {
      expect(all).not.toContain(word);
    }
  });

  it('viser en tom tilstand frem for en tom skærm', async () => {
    await render();
    expect(texts()).toContain(i18n.t('documents.empty'));
  });

  it('sender det valgte dokument videre og rydder op bagefter', async () => {
    mockUploadDocument.mockResolvedValue({ ok: true, document });
    mockPick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///app/cache/pick', name: 'lease.pdf', size: 2048, mimeType: 'application/pdf' }],
    });
    await render();

    await act(async () => { await button((label) => label === i18n.t('documents.upload')).props.onPress(); });

    expect(mockPick).toHaveBeenCalledWith({ type: '*/*', copyToCacheDirectory: true });
    expect(mockUploadDocument).toHaveBeenCalledWith({
      uri: 'file:///app/cache/pick', name: 'lease.pdf', size: 2048, mimeType: 'application/pdf',
    });
    expect(cleanupTemporaryPickerFile).toHaveBeenCalledWith('file:///app/cache/pick');
    expect(useDocumentsStore.getState().documents).toEqual([document]);
  });

  it('gør ingenting når brugeren fortryder', async () => {
    mockPick.mockResolvedValue({ canceled: true, assets: null });
    await render();
    await act(async () => { await button((label) => label === i18n.t('documents.upload')).props.onPress(); });
    expect(mockUploadDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['upload-failed'],
    ['metadata-failed'],
    ['not-authenticated'],
    ['invalid-file'],
  ])('siger hvad der gik galt ved %s, i stedet for at lade som om det lykkedes', async (reason) => {
    mockUploadDocument.mockResolvedValue({ ok: false, reason });
    mockPick.mockResolvedValue({
      canceled: false, assets: [{ uri: 'file:///app/cache/pick', name: 'lease.pdf', size: 1 }],
    });
    await render();
    await act(async () => { await button((label) => label === i18n.t('documents.upload')).props.onPress(); });

    expect(texts()).toContain(i18n.t(`documents.errors.${reason}`));
    expect(useDocumentsStore.getState().documents).toEqual([]);
  });

  it('udsteder den signerede URL først når rækken trykkes på', async () => {
    await render([document]);
    expect(mockDocumentReadUrl).not.toHaveBeenCalled();

    await act(async () => { await button((label) => label.includes('lease-agreement.pdf')).props.onPress(); });

    expect(mockDocumentReadUrl).toHaveBeenCalledWith(document.storagePath);
    expect(Linking.openURL).toHaveBeenCalledWith('https://storage.example/signed-1');
    // The URL is handed to the OS and dropped; it never enters persisted state.
    expect(JSON.stringify(useDocumentsStore.getState().documents)).not.toContain('signed-1');
  });

  it('siger det, når dokumentet ikke kunne åbnes', async () => {
    mockDocumentReadUrl.mockResolvedValue(null);
    await render([document]);
    await act(async () => { await button((label) => label.includes('lease-agreement.pdf')).props.onPress(); });
    expect(texts()).toContain(i18n.t('documents.errors.open-failed'));
  });
});

describe('store-laget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDocumentsStore.setState({ documents: [], uploading: false, uploadError: null });
  });

  it('tilføjer intet lokalt når serveren ikke bekræftede', async () => {
    mockUploadDocument.mockResolvedValue({ ok: false, reason: 'upload-failed' });
    const ok = await useDocumentsStore.getState().addDocument({ uri: 'file:///app/cache/x', name: 'x.pdf' });
    expect(ok).toBe(false);
    expect(useDocumentsStore.getState().documents).toEqual([]);
    expect(useDocumentsStore.getState().uploadError).toBe('upload-failed');
  });

  it('rydder den midlertidige fil op, også når uploadet fejlede', async () => {
    mockUploadDocument.mockResolvedValue({ ok: false, reason: 'metadata-failed' });
    await useDocumentsStore.getState().addDocument({ uri: 'file:///app/cache/x', name: 'x.pdf' });
    expect(cleanupTemporaryPickerFile).toHaveBeenCalledWith('file:///app/cache/x');
  });

  it('lader ikke en mislykket hentning ligne en tom konto', async () => {
    useDocumentsStore.setState({ documents: [document] });
    mockFetchDocuments.mockResolvedValue(null);
    await useDocumentsStore.getState().fetchFromSupabase();
    expect(useDocumentsStore.getState().documents).toEqual([document]);
  });

  it('erstatter cachen med serverens svar', async () => {
    useDocumentsStore.setState({ documents: [document] });
    mockFetchDocuments.mockResolvedValue([]);
    await useDocumentsStore.getState().fetchFromSupabase();
    expect(useDocumentsStore.getState().documents).toEqual([]);
  });
});

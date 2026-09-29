/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Alert, StyleSheet, Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Linking } from 'react-native';

import DocumentsScreen from '@/app/documents/index';
import { clearVerification, markVerified } from '@/core/auth/reauth';
import { PUBLIC_VIEWER, evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import { MODULE_IDS, getModule, moduleAccess } from '@/core/modules/moduleRegistry';
import { moduleForPath } from '@/core/modules/moduleRoutes';
import { canToggleModule } from '@/core/modules/moduleEnablement';
import i18n from '@/localization/i18n';
import daDocuments from '@/localization/locales/da/documents.json';
import enDocuments from '@/localization/locales/en/documents.json';
import { useDocumentsStore } from '@/store/useDocumentsStore';

/**
 * APP-055 and APP-056 — the module's maturity and the screen that makes it real.
 *
 * `internal` is still the load-bearing assertion: the domain is now complete —
 * a document can be put in and taken out — but Production has not received the
 * schema, and making the module visible is its own activation gate.
 *
 * Deletion is tested through the REAL APP-024 hook. Only its inputs are stubbed
 * — the device's biometrics and PIN, and the signed-in session — so what is
 * proved is that the destructive call genuinely waits for the proof.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/utils/auth/pinAuth', () => ({
  clearLocalPin: jest.fn(),
  hasPin: jest.fn(() => Promise.resolve(false)),
  verifyPin: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/core/documents/documentSync', () => ({
  cleanupTemporaryPickerFile: jest.fn(() => Promise.resolve()),
  deleteDocument: jest.fn(),
  documentReadUrl: jest.fn(() => Promise.resolve('https://storage.example/signed-1')),
  fetchDocuments: jest.fn(() => Promise.resolve([])),
  uploadDocument: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));

const mockHasHardware = jest.fn();
const mockIsEnrolled = jest.fn();
const mockAuthenticate = jest.fn();
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: () => mockHasHardware(),
  isEnrolledAsync: () => mockIsEnrolled(),
  authenticateAsync: (...args: unknown[]) => mockAuthenticate(...args),
}));
// The hook reads one thing from the auth store: the session, for the password step.
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ session: { user: { email: 'owner@example.test' } } }),
}));

import {
  cleanupTemporaryPickerFile,
  deleteDocument,
  documentReadUrl,
  fetchDocuments,
  uploadDocument,
} from '@/core/documents/documentSync';

const mockPick = DocumentPicker.getDocumentAsync as jest.Mock;
const mockUploadDocument = uploadDocument as jest.Mock;
const mockFetchDocuments = fetchDocuments as jest.Mock;
const mockDocumentReadUrl = documentReadUrl as jest.Mock;
const mockDeleteDocument = deleteDocument as jest.Mock;

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_DOC = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const document = {
  id: DOC,
  storagePath: `${USER}/${DOC}`,
  originalName: 'lease-agreement.pdf',
  createdAt: '2026-09-25T09:00:00.000Z',
};
const otherDocument = {
  id: OTHER_DOC,
  storagePath: `${USER}/${OTHER_DOC}`,
  originalName: 'payslip-august.pdf',
  createdAt: '2026-09-20T09:00:00.000Z',
};

const DELETE_FAILURES = ['not-authenticated', 'not-found', 'invalid-response', 'delete-incomplete'] as const;
const SECRETS = [document.storagePath, USER, DOC, 'https://storage.example/signed-1', 'file://'];

const resetStore = (documents: (typeof document)[] = []) =>
  useDocumentsStore.setState({ documents, uploading: false, uploadError: null, deletingId: null, deleteError: null });

/** A promise the test settles by hand, for "while the deletion is still running". */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return { promise, settle };
}

describe('modulets plads i registret', () => {
  it('findes som documents med document-sensitivity og ejer /documents', () => {
    expect(MODULE_IDS).toContain('documents');
    const definition = getModule('documents');
    expect(definition.sensitivity).toEqual(['document']);
    expect(definition.routeRoots).toEqual(['/documents']);
    expect(moduleForPath('/documents')).toBe('documents');
    expect(moduleForPath('/documents/whatever')).toBe('documents');
  });

  it('er stadig internal — Production har ikke fået APP-055/056, og aktivering er sin egen gate', () => {
    expect(getModule('documents').availability).toBe('internal');
  });

  it('påstår ikke længere, at APP-056 mangler sletningen', () => {
    for (const file of ['core/modules/moduleRegistry.ts', 'app/documents/index.tsx']) {
      const source = read(file);
      expect(source).not.toMatch(/APP-056 still owns/);
      expect(source).not.toMatch(/no delete action/i);
    }
    expect(read('core/modules/moduleRegistry.ts')).toMatch(/APP-056 adds the per-document delete cascade/);
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

describe('teksterne', () => {
  const keysOf = (value: object, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, child]) =>
      typeof child === 'object' && child !== null ? keysOf(child, `${prefix}${key}.`) : [`${prefix}${key}`]);

  it('har præcis de samme nøgler på dansk og engelsk, og ingen tomme tekster', () => {
    expect(keysOf(daDocuments).sort()).toEqual(keysOf(enDocuments).sort());
    for (const language of ['da', 'en']) {
      for (const key of keysOf(daDocuments)) {
        const value = i18n.getFixedT(language)(`documents.${key}`, { name: 'x.pdf', date: '1' });
        expect(value).not.toBe(`documents.${key}`);
        expect(value.trim()).not.toBe('');
      }
    }
  });

  it('har en besked på begge sprog for hver sletningsfejl, storen kan holde', () => {
    for (const language of ['da', 'en']) {
      for (const reason of DELETE_FAILURES) {
        expect(i18n.getFixedT(language)(`documents.deleteErrors.${reason}`)).not.toBe(`documents.deleteErrors.${reason}`);
      }
    }
  });
});

describe('skærmen', () => {
  let tree: TestRenderer.ReactTestRenderer;
  let alert: jest.SpyInstance;
  let announce: jest.SpyInstance;

  const texts = () => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join('')).join(' | ');
  const buttons = () =>
    tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
  const labels = () => buttons().map((n) => String(n.props.accessibilityLabel ?? '')).filter(Boolean);
  const button = (match: (label: string) => boolean) =>
    buttons().find((n) => match(String(n.props.accessibilityLabel ?? '')))!;
  // The open label carries the name AND the date; the delete label only the name.
  const openButton = (name = document.originalName) => button((label) => label.includes(name) && label.includes('2026'));
  const deleteButton = (name = document.originalName) =>
    button((label) => label === i18n.t('documents.deleteLabel', { name }));

  /** Settle the chain of effects and awaits the real hook and the store run through. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  };

  // The screen refreshes from the server on mount, so the seed goes through the
  // fetch the way it does in the app rather than being injected behind it.
  const render = async (documents: (typeof document)[] = []) => {
    mockFetchDocuments.mockResolvedValue(documents);
    resetStore(documents);
    await act(async () => { tree = TestRenderer.create(<DocumentsScreen />); });
  };

  /** Tap delete on a row and return what the confirmation dialog was given. */
  const tapDelete = async (name = document.originalName) => {
    await act(async () => { deleteButton(name).props.onPress(); });
    const [title, body, choices] = alert.mock.calls[alert.mock.calls.length - 1];
    return {
      title: String(title),
      body: String(body),
      choices: choices as { text: string; style?: string; onPress?: () => unknown }[],
    };
  };

  // Fired, not awaited: with a fresh proof the press runs the deletion itself,
  // and a test may be holding that deletion open on purpose.
  const confirm = async (dialog: Awaited<ReturnType<typeof tapDelete>>) => {
    await act(async () => { void dialog.choices.find((choice) => choice.style === 'destructive')!.onPress!(); });
    await settle();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    clearVerification();
    mockFetchDocuments.mockResolvedValue([]);
    mockDocumentReadUrl.mockResolvedValue('https://storage.example/signed-1');
    mockDeleteDocument.mockResolvedValue({ ok: true, outcome: 'deleted' });
    // A device with no biometrics and no app-lock PIN: the proof falls back to the
    // account password, which these tests never enter.
    mockHasHardware.mockResolvedValue(false);
    mockIsEnrolled.mockResolvedValue(false);
    mockAuthenticate.mockResolvedValue({ success: false });
    resetStore();
    await i18n.changeLanguage('da');
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => { tree?.unmount(); });
    alert.mockRestore();
    announce.mockRestore();
    clearVerification();
  });

  it.each(['da', 'en'])('viser filnavn og dato — og aldrig sti, URL eller bruger-id — på %s', async (language) => {
    await act(async () => { await i18n.changeLanguage(language); });
    await render([document]);

    const rendered = texts();
    expect(rendered).toContain('lease-agreement.pdf');
    expect(rendered).toMatch(/2026/);

    for (const secret of SECRETS) {
      expect(rendered).not.toContain(secret);
      expect(labels().join(' ')).not.toContain(secret);
    }
  });

  it('giver upload, åbn og slet hver sin knap-rolle og en læsbar etiket', async () => {
    await render([document]);

    expect(labels()).toContain(i18n.t('documents.upload'));
    // The row label carries both facts, because the icon and the muted date line
    // are not announced on their own.
    expect(openButton()).toBeTruthy();
    expect(deleteButton()).toBeTruthy();
    expect(deleteButton().props.accessibilityHint).toBe(i18n.t('documents.deleteHint'));
  });

  it('har slet-knappen ved siden af åbn-knappen — aldrig inden i den — og med et stort nok mål', async () => {
    await render([document]);

    const open = openButton();
    const remove = deleteButton();
    expect(open).not.toBe(remove);
    // Not nested: the open control contains no delete control, and vice versa.
    expect(open.findAll((n) => n.props.accessibilityLabel === remove.props.accessibilityLabel)).toHaveLength(0);
    expect(remove.findAll((n) => n.props.accessibilityLabel === open.props.accessibilityLabel)).toHaveLength(0);

    for (const control of [open, remove]) {
      const style = StyleSheet.flatten(control.props.style({ pressed: false }));
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(StyleSheet.flatten(remove.props.style({ pressed: false })).minWidth).toBeGreaterThanOrEqual(44);
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

    await act(async () => { await openButton().props.onPress(); });

    expect(mockDocumentReadUrl).toHaveBeenCalledWith(document.storagePath);
    expect(Linking.openURL).toHaveBeenCalledWith('https://storage.example/signed-1');
    // The URL is handed to the OS and dropped; it never enters persisted state.
    expect(JSON.stringify(useDocumentsStore.getState().documents)).not.toContain('signed-1');
  });

  it('siger det, når dokumentet ikke kunne åbnes', async () => {
    mockDocumentReadUrl.mockResolvedValue(null);
    await render([document]);
    await act(async () => { await openButton().props.onPress(); });
    expect(texts()).toContain(i18n.t('documents.errors.open-failed'));
  });

  /* ------------------------------------------------------------ deletion */

  it.each(['da', 'en'])('bekræftelsen nævner filnavnet og siger, at det er permanent — på %s', async (language) => {
    await act(async () => { await i18n.changeLanguage(language); });
    await render([document]);

    const dialog = await tapDelete();
    expect(dialog.title).toBe(i18n.t('documents.deleteConfirmTitle'));
    expect(dialog.body).toBe(i18n.t('documents.deleteConfirmBody', { name: 'lease-agreement.pdf' }));
    expect(dialog.body).toContain('lease-agreement.pdf');
    expect(dialog.choices.map((choice) => choice.style)).toEqual(['cancel', 'destructive']);
    expect(dialog.choices.map((choice) => choice.text))
      .toEqual([i18n.t('documents.cancel'), i18n.t('documents.deleteConfirm')]);

    // Nothing technical reaches the dialog either.
    const shown = [dialog.title, dialog.body, ...dialog.choices.map((choice) => choice.text)].join(' ');
    for (const secret of SECRETS) expect(shown).not.toContain(secret);

    // Showing the confirmation is not deleting.
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  it('fortryd i bekræftelsen sender intet og beder ikke om bevis', async () => {
    await render([document]);
    const dialog = await tapDelete();

    const cancel = dialog.choices.find((choice) => choice.style === 'cancel')!;
    await act(async () => { cancel.onPress?.(); });
    await settle();

    expect(mockDeleteDocument).not.toHaveBeenCalled();
    expect(texts()).not.toContain(i18n.t('reauth.title'));
    expect(useDocumentsStore.getState().documents).toEqual([document]);
  });

  it('APP-024: uden et friskt bevis vises prompten, og intet slettes — heller ikke når beviset afvises', async () => {
    await render([document]);
    await confirm(await tapDelete());

    // The real hook asked for proof ({reauthPrompt} is rendered), and the
    // destructive call is still waiting behind it.
    expect(texts()).toContain(i18n.t('reauth.title'));
    expect(mockDeleteDocument).not.toHaveBeenCalled();

    // Cancelling the proof abandons the deletion entirely.
    const cancelProof = tree.root.findAll((n) =>
      n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && n.findAllByType(Text).some((textNode) => textNode.props.children === i18n.t('warranties.cancel')))[0];
    await act(async () => { cancelProof.props.onPress(); });
    await settle();

    expect(texts()).not.toContain(i18n.t('reauth.title'));
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    expect(useDocumentsStore.getState().documents).toEqual([document]);
  });

  it('APP-024: et biometrisk bevis lukker op for præcis den sletning, der blev bekræftet', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });
    await render([document, otherDocument]);

    await confirm(await tapDelete());

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockDeleteDocument).toHaveBeenCalledTimes(1);
    expect(mockDeleteDocument).toHaveBeenCalledWith(DOC);
    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);
    expect(announce).toHaveBeenCalledWith(i18n.t('documents.deleted'));
  });

  it('APP-024: et friskt bevis springer prompten over, men ikke bekræftelsen', async () => {
    markVerified(Date.now());
    await render([document]);

    const dialog = await tapDelete();
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    await confirm(dialog);

    expect(texts()).not.toContain(i18n.t('reauth.title'));
    expect(mockDeleteDocument).toHaveBeenCalledWith(DOC);
  });

  it('mens sletningen kører, står rækken, viser Sletter … og alle slet-knapper er spærret', async () => {
    markVerified(Date.now());
    const pending = deferred<unknown>();
    mockDeleteDocument.mockReturnValue(pending.promise);
    await render([document, otherDocument]);

    await confirm(await tapDelete());

    expect(texts()).toContain(i18n.t('documents.deleting'));
    expect(useDocumentsStore.getState().documents).toEqual([document, otherDocument]);
    for (const name of [document.originalName, otherDocument.originalName]) {
      expect(deleteButton(name).props.disabled).toBe(true);
    }
    expect(deleteButton().props.accessibilityState).toEqual({ disabled: true, busy: true });
    // The row being deleted cannot be opened halfway through, either.
    expect(openButton().props.disabled).toBe(true);

    await act(async () => { pending.settle({ ok: true, outcome: 'deleted' }); });
    await settle();

    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);
    expect(texts()).not.toContain('lease-agreement.pdf');
    expect(deleteButton(otherDocument.originalName).props.disabled).toBe(false);
  });

  it.each(DELETE_FAILURES)('ved %s bliver dokumentet stående med en besked, og der kan prøves igen', async (reason) => {
    markVerified(Date.now());
    mockDeleteDocument.mockResolvedValue({ ok: false, reason });
    await render([document]);

    await confirm(await tapDelete());

    expect(texts()).toContain(i18n.t(`documents.deleteErrors.${reason}`));
    expect(texts()).toContain('lease-agreement.pdf');
    expect(useDocumentsStore.getState().documents).toEqual([document]);
    expect(announce).not.toHaveBeenCalled();

    // Retry is the same action again, and it is available.
    expect(deleteButton().props.disabled).toBe(false);
    mockDeleteDocument.mockResolvedValue({ ok: true, outcome: 'already-deleted' });
    await confirm(await tapDelete());
    expect(useDocumentsStore.getState().documents).toEqual([]);
    expect(texts()).not.toContain(i18n.t(`documents.deleteErrors.${reason}`));
  });
});

describe('store-laget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
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

describe('store-laget — sletning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore([document, otherDocument]);
  });

  it('fjerner intet optimistisk: dokumentet står, til serveren har bekræftet', async () => {
    const pending = deferred<unknown>();
    mockDeleteDocument.mockReturnValue(pending.promise);

    const deletion = useDocumentsStore.getState().deleteDocument(DOC);
    expect(useDocumentsStore.getState().documents).toEqual([document, otherDocument]);
    expect(useDocumentsStore.getState().deletingId).toBe(DOC);

    pending.settle({ ok: true, outcome: 'deleted' });
    expect(await deletion).toBe(true);
    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);
    expect(useDocumentsStore.getState().deletingId).toBeNull();
    expect(useDocumentsStore.getState().deleteError).toBeNull();
  });

  it.each(DELETE_FAILURES)('beholder dokumentet ved %s og husker fejlen', async (reason) => {
    mockDeleteDocument.mockResolvedValue({ ok: false, reason });
    expect(await useDocumentsStore.getState().deleteDocument(DOC)).toBe(false);
    expect(useDocumentsStore.getState().documents).toEqual([document, otherDocument]);
    expect(useDocumentsStore.getState().deleteError).toBe(reason);
    expect(useDocumentsStore.getState().deletingId).toBeNull();
  });

  it('en kastet fejl fra kernen bliver en fejl, der kan prøves igen — aldrig en sletning', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('unexpected'));
    expect(await useDocumentsStore.getState().deleteDocument(DOC)).toBe(false);
    expect(useDocumentsStore.getState().documents).toEqual([document, otherDocument]);
    expect(useDocumentsStore.getState().deleteError).toBe('delete-incomplete');
  });

  it('already-deleted fjerner den forældede post', async () => {
    mockDeleteDocument.mockResolvedValue({ ok: true, outcome: 'already-deleted' });
    expect(await useDocumentsStore.getState().deleteDocument(DOC)).toBe(true);
    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);
  });

  it('to hurtige tryk starter kun én sletning', async () => {
    const pending = deferred<unknown>();
    mockDeleteDocument.mockReturnValue(pending.promise);

    const first = useDocumentsStore.getState().deleteDocument(DOC);
    // The same document again, and a different one: both refused while one runs.
    expect(await useDocumentsStore.getState().deleteDocument(DOC)).toBe(false);
    expect(await useDocumentsStore.getState().deleteDocument(OTHER_DOC)).toBe(false);
    expect(mockDeleteDocument).toHaveBeenCalledTimes(1);

    pending.settle({ ok: true, outcome: 'deleted' });
    expect(await first).toBe(true);
  });

  it('en ny sletning rydder den forrige fejl', async () => {
    mockDeleteDocument.mockResolvedValueOnce({ ok: false, reason: 'delete-incomplete' });
    await useDocumentsStore.getState().deleteDocument(DOC);
    expect(useDocumentsStore.getState().deleteError).toBe('delete-incomplete');

    mockDeleteDocument.mockResolvedValueOnce({ ok: true, outcome: 'deleted' });
    await useDocumentsStore.getState().deleteDocument(DOC);
    expect(useDocumentsStore.getState().deleteError).toBeNull();
  });

  it('den flygtige sletnings-tilstand persisteres aldrig — kun documents[]', async () => {
    const { partialize } = useDocumentsStore.persist.getOptions();
    expect(partialize!({ ...useDocumentsStore.getState(), deletingId: DOC, deleteError: 'delete-incomplete' }))
      .toEqual({ documents: [document, otherDocument] });

    // And through a real write, during a deletion in flight and after a failure.
    const original = useDocumentsStore.persist.getOptions().storage;
    const written: { state: Record<string, unknown> }[] = [];
    useDocumentsStore.persist.setOptions({
      storage: {
        getItem: () => null,
        setItem: (_name: string, value: { state: Record<string, unknown> }) => { written.push(value); },
        removeItem: () => undefined,
      } as never,
    });
    try {
      mockDeleteDocument.mockResolvedValue({ ok: false, reason: 'delete-incomplete' });
      await useDocumentsStore.getState().deleteDocument(DOC);
    } finally {
      useDocumentsStore.persist.setOptions({ storage: original });
    }
    expect(written.length).toBeGreaterThan(0);
    for (const value of written) expect(Object.keys(value.state)).toEqual(['documents']);
  });

  it('en lokal skrivefejl efter serverens bekræftelse gør den aldrig til "ikke slettet"', async () => {
    mockDeleteDocument.mockResolvedValue({ ok: true, outcome: 'deleted' });
    const original = useDocumentsStore.persist.getOptions().storage;
    useDocumentsStore.persist.setOptions({
      storage: {
        getItem: () => null,
        // The encrypted write fails exactly when the deleted document leaves the list.
        setItem: (_name: string, value: { state: { documents: { id: string }[] } }) => {
          if (!value.state.documents.some((d) => d.id === DOC)) throw new Error('disk full');
        },
        removeItem: () => undefined,
      } as never,
    });
    let result: boolean;
    try {
      result = await useDocumentsStore.getState().deleteDocument(DOC);
    } finally {
      useDocumentsStore.persist.setOptions({ storage: original });
    }

    // The server said deleted, so the app says deleted: the in-memory list already
    // changed, no error is shown, and the next fetch is the authority on the cache.
    expect(result!).toBe(true);
    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);
    expect(useDocumentsStore.getState().deleteError).toBeNull();
    expect(useDocumentsStore.getState().deletingId).toBeNull();
  });

  it('en hentning, der var undervejs mens en sletning blev bekræftet, bringer ikke dokumentet tilbage', async () => {
    // The read left before the deletion finished, so its answer still lists it.
    const staleRead = deferred<unknown>();
    mockFetchDocuments.mockReturnValueOnce(staleRead.promise);
    const refresh = useDocumentsStore.getState().fetchFromSupabase();

    mockDeleteDocument.mockResolvedValue({ ok: true, outcome: 'deleted' });
    expect(await useDocumentsStore.getState().deleteDocument(DOC)).toBe(true);

    staleRead.settle([document, otherDocument]);
    await refresh;
    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);

    // The next read, started after the deletion, is applied as usual.
    const uploadedElsewhere = { ...otherDocument, id: 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', originalName: 'new.pdf' };
    mockFetchDocuments.mockResolvedValue([uploadedElsewhere, otherDocument]);
    await useDocumentsStore.getState().fetchFromSupabase();
    expect(useDocumentsStore.getState().documents).toEqual([uploadedElsewhere, otherDocument]);
  });

  it('hentning er stadig autoritativ efter en fejlet sletning', async () => {
    mockDeleteDocument.mockResolvedValue({ ok: false, reason: 'delete-incomplete' });
    await useDocumentsStore.getState().deleteDocument(DOC);

    // The server still has it: it stays.
    mockFetchDocuments.mockResolvedValue([document, otherDocument]);
    await useDocumentsStore.getState().fetchFromSupabase();
    expect(useDocumentsStore.getState().documents).toEqual([document, otherDocument]);

    // The server no longer has it (an earlier attempt finished after all): it goes.
    mockFetchDocuments.mockResolvedValue([otherDocument]);
    await useDocumentsStore.getState().fetchFromSupabase();
    expect(useDocumentsStore.getState().documents).toEqual([otherDocument]);
  });
});

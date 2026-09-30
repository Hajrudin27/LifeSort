/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

/**
 * APP-058 — a trip's documents and its deletion, as the user meets them, and the
 * architecture around them.
 *
 * Travel holds LINKS to standalone Documents and reads them through the narrow
 * reference boundary; it never imports the documents store. Linked Documents are
 * never deleted with a trip. The deletion preview is the server's, fails closed, and
 * offers the destructive button only when the server says the caller owns the trip.
 */

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  // The detail screen puts its edit action in the header; render it so it can be pressed.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/DatePickerField', () => function MockDatePickerField() { return null; });
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) }, from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/utils/shared/attachmentStorage', () => ({ cleanupAttachments: jest.fn(), deleteCachedAttachmentFile: jest.fn() }));
jest.mock('@/utils/trip/tripReminder', () => ({
  scheduleTripPackingReminder: jest.fn(() => Promise.resolve()),
  cancelTripPackingReminder: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/utils/trip/currencyConversion', () => ({ fetchExchangeRate: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('@/utils/trip/tripRemote', () => ({
  fetchTripDeletionPreview: jest.fn(),
  deleteTripRemote: jest.fn(),
  fetchTripDocumentLinks: jest.fn(),
  linkTripDocument: jest.fn(),
  unlinkTripDocument: jest.fn(),
}));
jest.mock('@/core/documents/documentReferences', () => ({ fetchDocumentReferences: jest.fn() }));
jest.mock('@/core/documents/documentSync', () => ({ uploadDocument: jest.fn(), cleanupTemporaryPickerFile: jest.fn(() => Promise.resolve()) }));
jest.mock('@/utils/trip/legacyTripDocuments', () => ({ moveLegacyTripDocumentToDocuments: jest.fn() }));

import * as DocumentPicker from 'expo-document-picker';

import TripDetailScreen from '@/app/travel/[id]/index';
import TripDeleteFlow from '@/components/TripDeleteFlow';
import TripDocumentsSection from '@/components/TripDocumentsSection';
import { fetchDocumentReferences } from '@/core/documents/documentReferences';
import { cleanupTemporaryPickerFile, uploadDocument } from '@/core/documents/documentSync';
import { getModule } from '@/core/modules/moduleRegistry';
import i18n from '@/localization/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import { useTripsStore } from '@/store/useTripsStore';
import { runInTripLane } from '@/utils/trip/tripWriteLane';
import { moveLegacyTripDocumentToDocuments } from '@/utils/trip/legacyTripDocuments';
import {
  deleteTripRemote, fetchTripDeletionPreview, fetchTripDocumentLinks, linkTripDocument, unlinkTripDocument,
} from '@/utils/trip/tripRemote';

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_DOC = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const refA = { id: DOC, originalName: 'ticket-rome.pdf', createdAt: '2026-09-25T09:00:00.000Z' };
const refB = { id: OTHER_DOC, originalName: 'hotel-booking.pdf', createdAt: '2026-09-20T09:00:00.000Z' };
const LEGACY_FILE = { id: 'att-1', uri: 'file:///doc/attachments/att-1.lsenc', name: 'boarding-pass.pdf', kind: 'document' as const };
const TRIP = { id: 'trip-1', ownerId: 'me', name: 'Rome', destination: 'Rome', startDate: '2027-05-01', endDate: '2027-05-08', budget: null, documents: [], createdAt: '2026-01-01T00:00:00.000Z' };

const m = {
  preview: fetchTripDeletionPreview as jest.Mock,
  deleteRemote: deleteTripRemote as jest.Mock,
  links: fetchTripDocumentLinks as jest.Mock,
  link: linkTripDocument as jest.Mock,
  unlink: unlinkTripDocument as jest.Mock,
  refs: fetchDocumentReferences as jest.Mock,
  upload: uploadDocument as jest.Mock,
  move: moveLegacyTripDocumentToDocuments as jest.Mock,
  pick: DocumentPicker.getDocumentAsync as jest.Mock,
};

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const settle = async () => { for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let tree: TestRenderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
};
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const hasButton = (label: string) => tree.root.findAllByProps({ label }).length > 0;
async function pressButton(label: string) {
  const button = tree.root.findAllByProps({ label })[0];
  const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function');
  await act(async () => { await pressable!.props.onPress(); });
  await settle();
}
const pressOption = async (name: string) => {
  await act(async () => { await tree.root.findAllByProps({ accessibilityLabel: name }).find((n) => typeof n.props.onPress === 'function')!.props.onPress(); });
  await settle();
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = { id: 'trip-1' };
  await i18n.changeLanguage('en');
  await useTripsStore.persist.rehydrate();
  useAuthStore.setState({ session: { user: { id: 'me' } } as never });
  useTripsStore.setState({
    trips: [TRIP], expenses: [], packingItems: [], participants: [], myUserId: 'me',
    // The screen asks for the participant list on mount; that read is not under test here.
    fetchParticipants: jest.fn(async () => undefined),
  });
  m.links.mockResolvedValue([]);
  m.refs.mockResolvedValue([refA, refB]);
});
afterEach(() => { act(() => { tree?.unmount(); }); });

describe('APP-058 architecture', () => {
  const TRAVEL_FILES = [
    'app/travel/index.tsx', 'app/travel/new.tsx', 'app/travel/[id]/index.tsx', 'app/travel/[id]/packing.tsx',
    'app/travel/[id]/expenses/index.tsx', 'app/travel/[id]/expenses/new.tsx', 'app/travel/[id]/expenses/edit/[expenseId].tsx',
    'components/TripDocumentsSection.tsx', 'components/TripDeleteFlow.tsx', 'components/TripAttachmentGrid.tsx',
    'store/useTripsStore.ts', 'types/trip.ts', 'utils/trip/tripDomain.ts', 'utils/trip/tripRemote.ts', 'utils/trip/legacyTripDocuments.ts',
  ];

  it('no Travel file imports the documents store', () => {
    for (const file of TRAVEL_FILES) expect(stripComments(read(file))).not.toMatch(/useDocumentsStore/);
  });

  it('Travel reaches documents only through the reference boundary and the uploader service', () => {
    const importsOf = (pattern: RegExp) => TRAVEL_FILES.filter((file) => pattern.test(stripComments(read(file))));
    expect(importsOf(/core\/documents\/documentReferences/)).toEqual(['components/TripDocumentsSection.tsx']);
    expect(importsOf(/core\/documents\/documentSync/)).toEqual(['components/TripDocumentsSection.tsx', 'utils/trip/legacyTripDocuments.ts']);
  });

  it('core learns nothing about trips', () => {
    for (const file of fs.readdirSync(path.join(REPO_ROOT, 'core/documents'))) {
      expect(read(`core/documents/${file}`)).not.toMatch(/useTripsStore|utils\/trip|types\/trip|app\/travel|trip_/);
    }
  });

  it('a trip stores no document name, path, URL or bytes', () => {
    const trip = stripComments(read('types/trip.ts'));
    expect(trip).not.toMatch(/storage_?path|signedUrl|originalName|DocumentReference/i);
    const store = stripComments(read('store/useTripsStore.ts'));
    expect(store).not.toMatch(/from\(['"]documents['"]\)|documentReferences|storage_path|createSignedUrl|trip_document_references/);
    // The link relation is only touched by the Travel remote module.
    expect(stripComments(read('utils/trip/tripRemote.ts'))).toMatch(/trip_document_references/);
    expect(stripComments(read('utils/trip/tripRemote.ts'))).not.toMatch(/storage_path|original_name|createSignedUrl/);
  });

  it('TripAttachment is gone; there is one attachment type', () => {
    expect(read('types/trip.ts')).not.toMatch(/interface TripAttachment/);
    for (const file of ['hooks/useAttachmentUri.ts', 'utils/shared/attachmentViewerSource.ts', 'components/TripAttachmentGrid.tsx']) {
      expect(read(file)).not.toMatch(/\bTripAttachment\b(?!Grid|Thumb)/);
    }
  });

  it('holds the story boundaries: no Economy bridge, no notification platform, no outbox, no reservation domain', () => {
    for (const file of TRAVEL_FILES) {
      const source = stripComments(read(file));
      expect(source).not.toMatch(/useExpensesStore|useIncomeStore|useSavingsGoalsStore|core\/money|core\/economy/);
      expect(source).not.toMatch(/core\/sync|enqueue|outbox|tombstone|revision/i);
    }
    expect(fs.existsSync(path.join(REPO_ROOT, 'types/reservation.ts'))).toBe(false);
    expect(read('utils/trip/tripReminder.ts')).toContain('travel.packingReminderTitle');
  });

  it('the store deletes no child rows itself: the trip row is the parent', () => {
    const store = stripComments(read('store/useTripsStore.ts'));
    // Individual user actions still delete one expense, one packing item or one invitee.
    // What is gone is the bulk cleanup after a trip delete: the store never deletes the
    // trip row itself, and never sweeps a trip's children by the author's user id.
    expect(store).not.toMatch(/from\(["']trips["']\)\s*\.delete/);
    expect(store).not.toMatch(/\.delete\(\)\s*\.eq\(["']user_id["']/);
    expect(store).not.toMatch(/syncDeleteTrip/);
    // Only one client row delete remains in Travel's remote module: unlinking a document. The trip
    // itself is deleted by the server call that checks the confirmed counts.
    expect(stripComments(read('utils/trip/tripRemote.ts')).match(/\.delete\(\)/g)).toHaveLength(1);
    expect(stripComments(read('utils/trip/tripRemote.ts'))).toMatch(/delete_trip_if_dependencies_match/);
  });

  it('Documents stays internal: Travel using the service does not activate it', () => {
    expect(getModule('documents').availability).toBe('internal');
    expect(getModule('travel').availability).toBe('available');
  });
});

describe('APP-058 trip documents section', () => {
  it('says nothing is linked, honestly, when the read worked and found none', async () => {
    await render(<TripDocumentsSection tripId="trip-1" />);
    expect(texts()).toContain(t('travel.docsNone'));
  });

  it('never shows a failed read as "nothing linked", and can retry', async () => {
    m.links.mockResolvedValue(null);
    await render(<TripDocumentsSection tripId="trip-1" />);
    expect(texts()).toContain(t('travel.docsLoadFailed'));
    expect(texts()).not.toContain(t('travel.docsNone'));
    m.links.mockResolvedValue([DOC]);
    await pressButton(t('travel.docsRetry'));
    expect(texts()).toContain('ticket-rome.pdf');
  });

  it('shows linked documents by name, and unlinking removes the link only', async () => {
    m.links.mockResolvedValue([DOC]);
    m.unlink.mockResolvedValue(true);
    await render(<TripDocumentsSection tripId="trip-1" />);
    expect(texts()).toContain('ticket-rome.pdf');

    m.links.mockResolvedValue([]);
    await pressButton(t('travel.docsUnlink'));
    expect(m.unlink).toHaveBeenCalledWith('trip-1', DOC);
    expect(texts()).toContain(t('travel.docsNone'));
    // Nothing in this component deletes a Document.
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('keeps the link and says so when unlinking fails', async () => {
    m.links.mockResolvedValue([DOC]);
    m.unlink.mockResolvedValue(false);
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsUnlink'));
    expect(texts()).toContain(t('travel.docsMessages.unlink-failed'));
    expect(texts()).toContain('ticket-rome.pdf');
  });

  it('links a saved document chosen from the picker, offering only unlinked ones', async () => {
    m.links.mockResolvedValue([DOC]);
    m.link.mockResolvedValue('linked');
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsLink'));
    expect(tree.root.findAllByProps({ accessibilityLabel: 'ticket-rome.pdf' })).toHaveLength(0);
    m.links.mockResolvedValue([DOC, OTHER_DOC]);
    await pressOption('hotel-booking.pdf');
    expect(m.link).toHaveBeenCalledWith('trip-1', OTHER_DOC);
  });

  it('keeps the picker open and says so when linking fails', async () => {
    m.link.mockResolvedValue('failed');
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsLink'));
    await pressOption('ticket-rome.pdf');
    expect(texts()).toContain(t('travel.docsMessages.link-failed'));
  });

  it('a failed document read is not "no documents"; an empty account says there are none', async () => {
    m.refs.mockResolvedValue(null);
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsLink'));
    expect(texts()).toContain(t('travel.docsPickerLoadFailed'));
    expect(texts()).not.toContain(t('travel.docsPickerEmpty'));

    m.refs.mockResolvedValue([]);
    await pressButton(t('travel.docsRetry'));
    expect(texts()).toContain(t('travel.docsPickerEmpty'));
  });

  it('adds a new file as a standalone Document first, then links what the server confirmed', async () => {
    m.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/DocumentPicker/x.pdf', name: 'visa.pdf', size: 10, mimeType: 'application/pdf' }] });
    m.upload.mockResolvedValue({ ok: true, document: { id: DOC, storagePath: 'u/d', originalName: 'visa.pdf', createdAt: 'x' } });
    m.link.mockResolvedValue('linked');
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsAddFile'));
    expect(m.upload).toHaveBeenCalledWith({ uri: 'file:///cache/DocumentPicker/x.pdf', name: 'visa.pdf', size: 10, mimeType: 'application/pdf' });
    expect(m.link).toHaveBeenCalledWith('trip-1', DOC);
    expect(m.upload.mock.invocationCallOrder[0]).toBeLessThan(m.link.mock.invocationCallOrder[0]);
    expect(cleanupTemporaryPickerFile).toHaveBeenCalledWith('file:///cache/DocumentPicker/x.pdf');
  });

  it('links nothing when the upload fails, and says the Document exists when only the link fails', async () => {
    m.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/x.pdf', name: 'visa.pdf' }] });
    m.upload.mockResolvedValue({ ok: false, reason: 'upload-failed' });
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsAddFile'));
    expect(m.link).not.toHaveBeenCalled();
    expect(texts()).toContain(t('travel.docsMessages.upload-failed'));
    expect(cleanupTemporaryPickerFile).toHaveBeenCalled();

    m.upload.mockResolvedValue({ ok: true, document: { id: DOC, storagePath: 'u/d', originalName: 'visa.pdf', createdAt: 'x' } });
    m.link.mockResolvedValue('failed');
    await pressButton(t('travel.docsAddFile'));
    expect(texts()).toContain(t('travel.docsMessages.link-failed'));
  });

  it('a cancelled picker does nothing', async () => {
    m.pick.mockResolvedValue({ canceled: true, assets: null });
    await render(<TripDocumentsSection tripId="trip-1" />);
    await pressButton(t('travel.docsAddFile'));
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('shows legacy on-device files separately and moves nothing until asked', async () => {
    useTripsStore.setState({ trips: [{ ...TRIP, documents: [LEGACY_FILE] }] });
    await render(<TripDocumentsSection tripId="trip-1" />);
    expect(texts()).toContain(t('travel.legacyLabel', { count: 1 }));
    expect(texts()).toContain('boarding-pass.pdf');
    expect(m.move).not.toHaveBeenCalled();
    expect(m.upload).not.toHaveBeenCalled();
    expect(useTripsStore.getState().trips[0].documents).toEqual([LEGACY_FILE]);
  });

  it('explicit move: success removes the legacy copy through the store; failure keeps it and says why', async () => {
    useTripsStore.setState({ trips: [{ ...TRIP, documents: [LEGACY_FILE] }] });
    await render(<TripDocumentsSection tripId="trip-1" />);

    m.move.mockResolvedValueOnce({ ok: false, reason: 'link-failed' });
    await pressButton(t('travel.legacyMove'));
    expect(texts()).toContain(t('travel.docsMessages.link-failed'));
    expect(useTripsStore.getState().trips[0].documents).toEqual([LEGACY_FILE]);

    // On success the orchestrator calls the callback it was given; that callback is what
    // removes the metadata (and, through the store, the encrypted local file).
    m.move.mockImplementationOnce(async (_tripId: string, _attachment: unknown, removeLegacy: () => void) => { removeLegacy(); return { ok: true, documentId: DOC }; });
    await pressButton(t('travel.legacyMove'));
    expect(useTripsStore.getState().trips[0].documents).toEqual([]);
    expect(texts()).toContain(t('travel.docsMessages.moved'));
  });
});

describe('APP-058 trip detail screen', () => {
  it('shows the destination, or says none is set for an older trip — never an invented one', async () => {
    await render(<TripDetailScreen />);
    expect(texts()).toContain('Rome');
    useTripsStore.setState({ trips: [{ ...TRIP, destination: undefined }] });
    await render(<TripDetailScreen />);
    expect(texts()).toContain(t('travel.destinationNotSet'));
  });

  const openEdit = async () => {
    const edit = tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
      && node.findAllByType(Text).some((text) => text.props.children === t('warranties.edit')))[0];
    await act(async () => { edit.props.onPress(); });
    await settle();
  };
  const ownerControls = () => ({
    documents: texts().includes(t('travel.docsHint')),
    invite: texts().includes(t('travel.inviteButton')),
  });
  const withTrip = (trip: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    useTripsStore.setState({ trips: [{ ...TRIP, ...trip }] as never, ...extra });

  it('a confirmed owner sees the owner controls — without waiting for any participant data', async () => {
    withTrip({ ownerId: 'me' }, { fetchParticipants: jest.fn(() => new Promise<void>(() => undefined)) }); // never answers
    await render(<TripDetailScreen />);
    expect(ownerControls()).toEqual({ documents: true, invite: true });
    expect(m.links).toHaveBeenCalled();
    await openEdit();
    expect(hasButton(t('warranties.delete'))).toBe(true);
  });

  it('while participant data is still loading, nobody unconfirmed is an owner', async () => {
    withTrip({ ownerId: 'someone-else' }, { fetchParticipants: jest.fn(() => new Promise<void>(() => undefined)) });
    await render(<TripDetailScreen />);
    expect(ownerControls()).toEqual({ documents: false, invite: false });
    expect(m.links).not.toHaveBeenCalled();
    await openEdit();
    expect(hasButton(t('warranties.delete'))).toBe(false);
  });

  it('when the participant fetch has FAILED, unknown ownership still fails closed', async () => {
    withTrip({ ownerId: undefined }, { participants: [], fetchParticipants: jest.fn(async () => undefined) });
    await render(<TripDetailScreen />);
    expect(ownerControls()).toEqual({ documents: false, invite: false });
    await openEdit();
    expect(hasButton(t('warranties.delete'))).toBe(false);
  });

  it('a legacy trip whose owner is unknown offers no owner control — no participant proof is needed to hide it', async () => {
    withTrip({ ownerId: undefined }, { participants: [] });
    await render(<TripDetailScreen />);
    expect(ownerControls()).toEqual({ documents: false, invite: false });
    expect(m.links).not.toHaveBeenCalled();
  });

  it('an accepted participant gets no owner control', async () => {
    withTrip({ ownerId: 'owner' }, {
      participants: [{ tripId: 'trip-1', ownerId: 'owner', userId: 'me', invitedEmail: 'me@example.test', status: 'accepted', invitedAt: 'x' }],
    });
    await render(<TripDetailScreen />);
    expect(ownerControls()).toEqual({ documents: false, invite: false });
    expect(m.links).not.toHaveBeenCalled();
    await openEdit();
    expect(hasButton(t('warranties.delete'))).toBe(false);
  });

  it('with no signed-in user there is no owner, even on a trip that names one', async () => {
    useAuthStore.setState({ session: null });
    withTrip({ ownerId: 'me' });
    await render(<TripDetailScreen />);
    expect(ownerControls()).toEqual({ documents: false, invite: false });
  });

  it('the screen never derives ownership from missing participants', () => {
    const screen = stripComments(read('app/travel/[id]/index.tsx'));
    expect(screen).not.toMatch(/participants\.length === 0\s*\?\s*true|isKnownParticipant|!isKnown/);
    expect(screen).toMatch(/trip\.ownerId === sessionUserId/);
  });
});

describe('APP-058 deletion preview and delete', () => {
  const ok = { ok: true, preview: { status: 'ok', expenses: 3, packingItems: 1, participants: 2, documents: 4 } };
  const onDeleted = jest.fn();
  const onClose = jest.fn();
  const flow = () => <TripDeleteFlow tripId="trip-1" visible onClose={onClose} onDeleted={onDeleted} />;

  it('shows the server\'s counts, and says linked Documents are kept', async () => {
    m.preview.mockResolvedValue(ok);
    await render(flow());
    expect(m.preview).toHaveBeenCalledWith('trip-1');
    const shown = texts();
    expect(shown).toContain('3 expenses');
    expect(shown).toContain('1 packing item');
    expect(shown).toContain('2 participants and invitations');
    expect(shown).toContain('4 document links');
    expect(shown).toContain(t('travel.deletePreviewDocumentsKept'));
    expect(t('travel.deletePreviewDocumentsKept')).toMatch(/not deleted/i);
    expect(hasButton(t('warranties.delete'))).toBe(true);
  });

  it('a genuine zero is shown as zero', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'ok', expenses: 0, packingItems: 0, participants: 0, documents: 0 } });
    await render(flow());
    expect(texts()).toEqual(expect.arrayContaining(['0 expenses', '0 packing items', '0 document links']));
  });

  it('labels legacy on-device files separately as this device\'s own count', async () => {
    m.preview.mockResolvedValue(ok);
    useTripsStore.setState({ trips: [{ ...TRIP, documents: [LEGACY_FILE, { ...LEGACY_FILE, id: 'att-2' }] }] });
    await render(flow());
    const line = texts().find((text) => /only on this device/.test(text));
    expect(line).toBe(t('travel.deletePreviewOnDevice', { count: 2 }));
    expect(line).toMatch(/not from the cloud/);
  });

  it('omits the on-device line when there are no legacy files', async () => {
    m.preview.mockResolvedValue(ok);
    await render(flow());
    expect(texts().some((text) => /only on this device/.test(text))).toBe(false);
  });

  it('fails closed: no counts, no delete button, a retry — and the retry works', async () => {
    m.preview.mockResolvedValue({ ok: false });
    await render(flow());
    expect(texts()).toContain(t('travel.deletePreviewFailed'));
    expect(hasButton(t('warranties.delete'))).toBe(false);
    expect(texts().some((text) => /expenses?$/.test(text))).toBe(false);
    m.preview.mockResolvedValue(ok);
    await pressButton(t('travel.deletePreviewRetry'));
    expect(hasButton(t('warranties.delete'))).toBe(true);
  });

  it('offers a non-owner no destructive action at all', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'not-owner' } });
    await render(flow());
    expect(texts()).toContain(t('travel.deleteNotOwner'));
    expect(hasButton(t('warranties.delete'))).toBe(false);
    expect(hasButton(t('travel.removeFromDevice'))).toBe(false);
    expect(m.deleteRemote).not.toHaveBeenCalled();
  });

  it('a trip the server does not have can only be removed from this device, without a server call', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'not-found' } });
    await render(flow());
    expect(hasButton(t('warranties.delete'))).toBe(false);
    await pressButton(t('travel.removeFromDevice'));
    expect(m.deleteRemote).not.toHaveBeenCalled();
    expect(useTripsStore.getState().trips).toEqual([]);
    expect(onDeleted).toHaveBeenCalled();
  });

  it('a server failure keeps the trip and everything local, and offers another try', async () => {
    m.preview.mockResolvedValue(ok);
    m.deleteRemote.mockResolvedValue({ ok: false, reason: 'failed' });
    useTripsStore.setState({ trips: [{ ...TRIP, documents: [LEGACY_FILE] }] });
    await render(flow());
    await pressButton(t('warranties.delete'));
    expect(m.deleteRemote).toHaveBeenCalledWith('trip-1', { expenses: 3, packingItems: 1, participants: 2, documents: 4 });
    expect(texts()).toContain(t('travel.deleteFailed'));
    expect(useTripsStore.getState().trips).toHaveLength(1);
    expect(useTripsStore.getState().trips[0].documents).toEqual([LEGACY_FILE]);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(hasButton(t('travel.deleteRetry'))).toBe(true);
  });

  it('a confirmed deletion clears the trip locally and reports done', async () => {
    m.preview.mockResolvedValue(ok);
    m.deleteRemote.mockResolvedValue({ ok: true });
    await render(flow());
    await pressButton(t('warranties.delete'));
    expect(useTripsStore.getState().trips).toEqual([]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('does not show the server\'s zero next to a local expense it is about to delete', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'ok', expenses: 0, packingItems: 0, participants: 0, documents: 0 } });
    useTripsStore.setState({ expenses: [{ id: 'e1', tripId: 'trip-1', name: 'Train', amount: 10, category: 'transport', attachments: [], createdAt: 'x' }] });
    await render(flow());
    const shown = texts();
    expect(shown).toContain('0 expenses'); // the server's number, under the server's heading
    expect(shown).toContain(t('travel.deleteServerHeading'));
    expect(shown).toContain(t('travel.deleteDeviceHeading'));
    expect(shown).toContain('1 expense on this device');
    expect(shown).toContain(t('travel.deleteDeviceUnsynced'));
    // The user sees all of it before the destructive button can be pressed.
    expect(hasButton(t('warranties.delete'))).toBe(true);
  });

  it('does the same for a local packing item the server does not count', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'ok', expenses: 0, packingItems: 0, participants: 0, documents: 0 } });
    useTripsStore.setState({ packingItems: [{ id: 'p1', tripId: 'trip-1', label: 'Coat', checked: false, isDefault: false, category: 'other' }, { id: 'p2', tripId: 'other', label: 'x', checked: false, isDefault: false, category: 'other' }] });
    await render(flow());
    expect(texts()).toContain('1 packing item on this device'); // only this trip's
    expect(texts()).toContain(t('travel.deleteDeviceUnsynced'));
  });

  it('lists device numbers without the warning when the server already counts at least as many', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'ok', expenses: 3, packingItems: 2, participants: 0, documents: 0 } });
    useTripsStore.setState({
      expenses: [{ id: 'e1', tripId: 'trip-1', name: 'Train', amount: 10, category: 'transport', attachments: [], createdAt: 'x' }],
      packingItems: [{ id: 'p1', tripId: 'trip-1', label: 'Coat', checked: false, isDefault: false, category: 'other' }],
    });
    await render(flow());
    expect(texts()).toContain('1 expense on this device');
    expect(texts()).not.toContain(t('travel.deleteDeviceUnsynced'));
  });

  it('shows nothing about the device when the device holds nothing for the trip', async () => {
    m.preview.mockResolvedValue(ok);
    await render(flow());
    expect(texts()).not.toContain(t('travel.deleteDeviceHeading'));
  });

  it('a trip the server does not have: every device-local item is shown BEFORE "Remove from this device"', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'not-found' } });
    useTripsStore.setState({
      trips: [{ ...TRIP, documents: [LEGACY_FILE] }],
      expenses: [
        { id: 'e1', tripId: 'trip-1', name: 'a', amount: 1, category: 'food', attachments: [], createdAt: 'x' },
        { id: 'e2', tripId: 'trip-1', name: 'b', amount: 1, category: 'food', attachments: [], createdAt: 'x' },
      ],
      packingItems: [{ id: 'p1', tripId: 'trip-1', label: 'Coat', checked: false, isDefault: false, category: 'other' }],
      participants: [{ tripId: 'trip-1', ownerId: 'someone', userId: 'me', invitedEmail: 'x@example.test', status: 'accepted', invitedAt: 'x' }],
    });
    await render(flow());
    const shown = texts();
    expect(shown).toEqual(expect.arrayContaining([
      t('travel.deleteNotOnServer'), t('travel.deleteDeviceHeading'),
      '2 expenses on this device', '1 packing item on this device', '1 invitation shown on this device',
      t('travel.deletePreviewOnDevice', { count: 1 }), t('travel.deleteDeviceUnsynced'),
    ]));
    expect(hasButton(t('travel.removeFromDevice'))).toBe(true);
    expect(m.deleteRemote).not.toHaveBeenCalled();
  });

  it('waits for the trip\'s own writes before asking the server, so a trip being created is not "not found"', async () => {
    m.preview.mockResolvedValue(ok);
    let release!: () => void;
    const writing = runInTripLane('trip-1', () => new Promise<void>((resolve) => { release = resolve; }));
    await render(flow());
    expect(m.preview).not.toHaveBeenCalled();
    release();
    await writing;
    await settle();
    expect(m.preview).toHaveBeenCalledWith('trip-1');
  });

  it('hands the server exactly the counts that were on screen when the user pressed delete', async () => {
    m.preview.mockResolvedValue({ ok: true, preview: { status: 'ok', expenses: 7, packingItems: 0, participants: 1, documents: 2 } });
    m.deleteRemote.mockResolvedValue({ ok: true });
    await render(flow());
    expect(texts()).toContain('7 expenses');
    await pressButton(t('warranties.delete'));
    expect(m.deleteRemote).toHaveBeenCalledTimes(1);
    expect(m.deleteRemote).toHaveBeenCalledWith('trip-1', { expenses: 7, packingItems: 0, participants: 1, documents: 2 });
  });

  it('when the trip changed after the preview: nothing is deleted, the fresh counts are shown, and the user must press delete AGAIN', async () => {
    m.preview.mockResolvedValue(ok); // 3 expenses, 1 packing item, 2 participants, 4 links
    m.deleteRemote
      .mockResolvedValueOnce({ ok: false, reason: 'changed', counts: { expenses: 4, packingItems: 1, participants: 2, documents: 4 } })
      .mockResolvedValueOnce({ ok: true });
    await render(flow());
    await pressButton(t('warranties.delete'));

    // One call, refused; the sheet is back in "preview", with the new numbers and a notice.
    expect(m.deleteRemote).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('4 expenses');
    expect(texts()).not.toContain('3 expenses');
    expect(texts()).toContain(t('travel.deleteChanged'));
    expect(useTripsStore.getState().trips).toHaveLength(1);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(hasButton(t('warranties.delete'))).toBe(true);
    // It did NOT go on to delete by itself.
    await settle();
    expect(m.deleteRemote).toHaveBeenCalledTimes(1);

    // The second, deliberate press confirms the counts now on screen.
    await pressButton(t('warranties.delete'));
    expect(m.deleteRemote).toHaveBeenCalledTimes(2);
    expect(m.deleteRemote).toHaveBeenLastCalledWith('trip-1', { expenses: 4, packingItems: 1, participants: 2, documents: 4 });
    expect(useTripsStore.getState().trips).toEqual([]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('can change more than once: each change asks again, none deletes', async () => {
    m.preview.mockResolvedValue(ok);
    m.deleteRemote
      .mockResolvedValueOnce({ ok: false, reason: 'changed', counts: { expenses: 4, packingItems: 1, participants: 2, documents: 4 } })
      .mockResolvedValueOnce({ ok: false, reason: 'changed', counts: { expenses: 4, packingItems: 2, participants: 2, documents: 4 } });
    await render(flow());
    await pressButton(t('warranties.delete'));
    await pressButton(t('warranties.delete'));
    expect(texts()).toContain('2 packing items');
    expect(m.deleteRemote).toHaveBeenCalledTimes(2);
    expect(useTripsStore.getState().trips).toHaveLength(1);
  });

  it('a server that says the caller is only a participant ends in the non-owner state', async () => {
    m.preview.mockResolvedValue(ok);
    m.deleteRemote.mockResolvedValue({ ok: false, reason: 'not-owner' });
    await render(flow());
    await pressButton(t('warranties.delete'));
    expect(texts()).toContain(t('travel.deleteNotOwner'));
    expect(hasButton(t('warranties.delete'))).toBe(false);
    expect(useTripsStore.getState().trips).toHaveLength(1);
  });

  it('asks the server nothing while hidden', async () => {
    await render(<TripDeleteFlow tripId="trip-1" visible={false} onClose={onClose} onDeleted={onDeleted} />);
    expect(m.preview).not.toHaveBeenCalled();
  });
});

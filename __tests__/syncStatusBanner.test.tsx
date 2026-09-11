import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '@/localization/i18n';
import SyncStatusBanner from '@/components/SyncStatusBanner';
import { useSyncStatusLifecycle } from '@/hooks/useSyncStatusLifecycle';
import { useAuthStore } from '@/store/useAuthStore';
import { useSyncStatusStore } from '@/store/useSyncStatusStore';
import { createOutbox, type OutboxMutation } from '@/core/sync/outbox';
import { sendServerMutation } from '@/core/sync/serverMutations';
import { projectSyncStatus, type SyncSafeErrorCode } from '@/core/sync/syncStatus';
import Colors from '@/constants/Colors';
import en from '@/localization/locales/en/common.json';
import da from '@/localization/locales/da/common.json';

let mockTheme = 'light';
jest.mock('@/components/useColorScheme', () => ({ useColorScheme: () => mockTheme }));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9' }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
}));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: require('zustand').create(() => ({ session: { user: { id: 'a' } } })),
}));
jest.mock('@/core/sync/serverMutations', () => ({ sendServerMutation: jest.fn() }));
const send = sendServerMutation as jest.Mock;
const entry: OutboxMutation = {
  mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dataDomain: 'core.module-choice',
  entityType: 'module-choice', entityId: 'habits', operation: 'upsert', payload: { enabled: true },
  createdAt: '2026-09-11T00:00:00Z', status: 'pending', attempts: 0,
};
let tree: TestRenderer.ReactTestRenderer;
function setProjection(entries: OutboxMutation[], code?: SyncSafeErrorCode, flight: string | null = null) {
  act(() => useSyncStatusStore.setState({ projection: projectSyncStatus('a', { accountId: 'a', mutations: entries },
    code ? new Map([[entry.mutationId, code]]) : new Map(), flight) }));
}
function render(element = <SyncStatusBanner />) { act(() => { tree = TestRenderer.create(element); }); }
function buttons() { return tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'); }
function text() { return tree.root.findAllByType(Text).map((node) => node.props.children).join(' '); }
beforeEach(async () => {
  await AsyncStorage.clear();
  mockTheme = 'light'; send.mockReset();
  useSyncStatusStore.getState().clearLocal();
  useAuthStore.setState({ session: { user: { id: 'a' } } as never });
  await i18n.changeLanguage('en');
});
afterEach(() => { if (tree) act(() => tree.unmount()); });

it('clear renders nothing', () => { render(); expect(tree.toJSON()).toBeNull(); });
it('pending uses subtle text and an explicit action without a modal or alert', () => {
  setProjection([entry]); render();
  expect(text()).toContain(en.syncStatus.pending);
  expect(buttons()[0].props.accessibilityLabel).toBe(en.syncStatus.retry);
});
it('failed renders safe text and an accessible Retry action', () => {
  setProjection([{ ...entry, status: 'failed' }], 'unavailable'); render();
  expect(text()).toContain(en.syncStatus.failed);
  const button = buttons()[0];
  expect(button.props.accessibilityRole).toBe('button');
  expect(button.props.accessibilityState).toEqual({ disabled: false });
});
it('retrying disables and labels the action without relying on color', () => {
  setProjection([entry], undefined, entry.mutationId); render();
  expect(text()).toContain(en.syncStatus.retrying);
  const button = buttons()[0];
  expect(button.props.disabled).toBe(true);
  expect(button.props.accessibilityState).toEqual({ disabled: true });
});
it.each<SyncSafeErrorCode>(['conflict', 'validation', 'unknown', 'auth-required'])('%s exposes no blind Retry', (code) => {
  setProjection([{ ...entry, status: 'failed' }], code); render();
  expect(buttons()).toHaveLength(0);
  expect(text()).toBe(code === 'auth-required' ? en.syncStatus.authRequired : en.syncStatus.needsAttention);
});
it('status text has a safe screen-reader label and polite announcement semantics', () => {
  setProjection([entry]); render();
  const message = tree.root.findAllByType(Text)[0];
  expect(message.props).toMatchObject({ accessibilityRole: 'text', accessibilityLiveRegion: 'polite',
    accessibilityLabel: en.syncStatus.pending });
});
it.each(['en', 'da'])('%s contains every visible state and action with no interpolation', (language) => {
  const copy = language === 'en' ? en.syncStatus : da.syncStatus;
  expect(Object.keys(copy).sort()).toEqual(['authRequired', 'failed', 'needsAttention', 'pending', 'retry', 'retrying']);
  for (const value of Object.values(copy)) { expect(value.length).toBeGreaterThan(0); expect(value).not.toContain('{{'); }
});
it('renders Danish and allows large text to wrap without fixed height or line truncation', async () => {
  await i18n.changeLanguage('da');
  setProjection([{ ...entry, status: 'failed' }], 'conflict'); render();
  expect(text()).toBe(da.syncStatus.needsAttention);
  for (const node of tree.root.findAllByType(Text)) {
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.allowFontScaling).not.toBe(false);
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    const style = StyleSheet.flatten(node.props.style);
    expect(style.height).toBeUndefined(); expect(style.position).not.toBe('absolute');
  }
});
it.each(['light', 'dark'] as const)('%s uses existing text and surface tokens', (mode) => {
  mockTheme = mode; setProjection([entry]); render();
  const message = tree.root.findAllByType(Text)[0];
  expect(StyleSheet.flatten(message.props.style).color).toBe(Colors[mode].textMuted);
  expect(JSON.stringify(tree.toJSON())).toContain(Colors[mode].surfaceMuted);
});
it('hides mismatched account state immediately, before any lifecycle effect', () => {
  setProjection([entry]);
  useAuthStore.setState({ session: { user: { id: 'b' } } as never });
  render(); expect(tree.toJSON()).toBeNull();
});
it('signed-out shell renders nothing', () => {
  setProjection([entry]); useAuthStore.setState({ session: null }); render(); expect(tree.toJSON()).toBeNull();
});
it('disappears quietly after durable state clears', () => {
  setProjection([entry]); render(); setProjection([]); expect(tree.toJSON()).toBeNull();
});
it('actual Retry tap sends once and durable success removes the shell surface', async () => {
  function Shell() { useSyncStatusLifecycle(); return <SyncStatusBanner />; }
  const queued = await createOutbox('a').enqueue({ dataDomain: entry.dataDomain, entityType: entry.entityType,
    entityId: entry.entityId, operation: entry.operation, payload: entry.payload });
  send.mockResolvedValue({ ok: true, status: 'applied' });
  await act(async () => { tree = TestRenderer.create(<Shell />); });
  await act(async () => {
    const button = buttons()[0];
    button.props.onPress(); button.props.onPress();
    await createOutbox('a').list(); await createOutbox('a').list(); await createOutbox('a').list();
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1].mutationId).toBe(queued.mutationId);
  expect(await createOutbox('a').list()).toEqual([]);
  expect(tree.toJSON()).toBeNull();
});

const privateFixtures = [
  'divorce-contract.pdf', 'pregnancy complication', 'salary 48,000',
  'PT409 entity_deleted for pregnancy outcome', 'SQL public.apply_sync_mutation function',
  'Error: private stack at file.ts:99', 'file:///private/documents/divorce-contract.pdf', 'Bearer private-jwt',
];
describe('privacy: rendered text and accessibility', () => {
  it.each(privateFixtures)('discards sensitive-looking fixture %#: visible and accessibility props remain generic', (detail) => {
    const projection = projectSyncStatus('a', { accountId: 'a', mutations: [
      { ...entry, payload: { detail }, message: detail, details: detail, stack: detail } as OutboxMutation,
    ] });
    useSyncStatusStore.setState({ projection }); render();
    expect(text()).toBe(en.syncStatus.needsAttention);
    expect(JSON.stringify(tree.toJSON())).not.toContain(detail);
    expect(tree.root.findAllByType(Text)[0].props.accessibilityLabel).toBe(en.syncStatus.needsAttention);
  });
});
it('failed one-shot result discards raw response details before rendering visible and accessible text', async () => {
  function Shell() { useSyncStatusLifecycle(); return <SyncStatusBanner />; }
  await createOutbox('a').enqueue({ dataDomain: entry.dataDomain, entityType: entry.entityType,
    entityId: entry.entityId, operation: entry.operation, payload: entry.payload });
  send.mockResolvedValue({ ok: false, reason: 'unavailable', message: privateFixtures.join(' '),
    details: privateFixtures, stack: privateFixtures.join('\n') });
  await act(async () => { tree = TestRenderer.create(<Shell />); });
  await act(async () => {
    buttons()[0].props.onPress();
    await createOutbox('a').list(); await createOutbox('a').list(); await createOutbox('a').list();
  });
  expect(text()).toContain(en.syncStatus.failed);
  for (const detail of privateFixtures) {
    expect(JSON.stringify(tree.toJSON())).not.toContain(detail);
    expect(JSON.stringify(useSyncStatusStore.getState())).not.toContain(detail);
  }
  expect(send).toHaveBeenCalledTimes(1);
});

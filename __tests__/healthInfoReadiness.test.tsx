import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

/**
 * APP-074 - the reference screens only render a library that this runtime refreshed completely.
 *
 * The store gate is `clinicalContentReady`; these tests prove the two screens a user actually meets honour
 * it, so cached/legacy rows already in memory are never shown while the gate is closed.
 */

let mockParams: { id?: string } = { id: 'governed' };

jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  cycleHealthEncryptedStorage: require('@react-native-async-storage/async-storage'),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));

import HealthInfoScreen from '@/app/cycle/health-info';
import HealthConditionDetailScreen from '@/app/cycle/health-info/[id]';
import i18n from '@/localization/i18n';
import { useCycleStore } from '@/store/useCycleStore';

const condition = {
  id: 'governed', contentVersion: 2, reviewDueAt: '2099-01-01',
  nameDa: 'Dansk tilstand', nameEn: 'Governed condition', summaryDa: 'Dansk resume', summaryEn: 'Governed summary',
  whatItIsDa: 'Dansk', whatItIsEn: 'Governed body', commonSymptoms: ['cramps'],
  whatHelpsDa: 'Dansk', whatHelpsEn: 'Helps', whenToSeeDoctorDa: 'Dansk', whenToSeeDoctorEn: 'Doctor',
};
const symptom = { id: 'cramps', contentVersion: 1, reviewDueAt: '2099-01-01', nameDa: 'Kramper', nameEn: 'Governed symptom', descriptionDa: 'Dansk', descriptionEn: 'Desc' };

let tree: TestRenderer.ReactTestRenderer | undefined;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree = TestRenderer.create(element); });
  return JSON.stringify(tree!.toJSON());
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mockParams = { id: 'governed' };
});
afterEach(() => {
  act(() => { tree?.unmount(); });
  tree = undefined;
  useCycleStore.setState({ healthConditions: [], symptomGlossary: [], clinicalContentReady: false });
});

describe('APP-074 reference screens honour the runtime readiness gate', () => {
  it('list: cached rows already in memory are not shown while the gate is closed', async () => {
    useCycleStore.setState({ healthConditions: [condition], symptomGlossary: [symptom], clinicalContentReady: false });
    const output = await render(<HealthInfoScreen />);
    expect(output).not.toContain('Governed condition');
    expect(output).toContain(i18n.t('healthInfo.emptyState'));
  });

  it('list: both tabs show the library once this runtime has completed a governed refresh', async () => {
    useCycleStore.setState({ healthConditions: [condition], symptomGlossary: [symptom], clinicalContentReady: true });
    expect(await render(<HealthInfoScreen />)).toContain('Governed condition');
  });

  it('list: a successful empty library is an empty state, not an error or a stale list', async () => {
    useCycleStore.setState({ healthConditions: [], symptomGlossary: [], clinicalContentReady: true });
    const output = await render(<HealthInfoScreen />);
    expect(output).toContain(i18n.t('healthInfo.emptyState'));
  });

  it('detail: a cached row is not shown by id while the gate is closed', async () => {
    useCycleStore.setState({ healthConditions: [condition], symptomGlossary: [symptom], clinicalContentReady: false });
    const output = await render(<HealthConditionDetailScreen />);
    expect(output).not.toContain('Governed body');
    expect(output).not.toContain('Governed symptom');
  });

  it('detail: renders the governed row and its published symptoms once the gate is open', async () => {
    useCycleStore.setState({ healthConditions: [condition], symptomGlossary: [symptom], clinicalContentReady: true });
    const output = await render(<HealthConditionDetailScreen />);
    expect(output).toContain('Governed body');
    expect(output).toContain('Governed symptom');
  });

  it('detail: a symptom id that is not in the published glossary is omitted, never a placeholder or a crash', async () => {
    useCycleStore.setState({ healthConditions: [{ ...condition, commonSymptoms: ['cramps', 'withdrawn-symptom'] }], symptomGlossary: [symptom], clinicalContentReady: true });
    const output = await render(<HealthConditionDetailScreen />);
    expect(output).toContain('Governed symptom');
    expect(output).not.toContain('withdrawn-symptom');
  });
});

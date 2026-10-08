import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import i18n from '@/localization/i18n';
import type { LifeGoal } from '@/types/life';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

import LifeScreen from '@/app/(tabs)/life';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';

const common = { title: 'Goal', milestones: [], createdAt: '2026-10-01T10:00:00.000Z' };
let tree: TestRenderer.ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const shown = async (goals: LifeGoal[]) => {
  useLifeGoalsStore.setState({ goals });
  await act(async () => { tree = TestRenderer.create(<LifeScreen />); });
  const label = i18n.t('life.progressLabel');
  const index = texts().indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  return texts()[index + 1];
};

beforeEach(async () => { await i18n.changeLanguage('en'); useLifeGoalsStore.getState().clearLocal(); });
afterEach(() => { act(() => tree.unmount()); });

describe('APP-063 Life dashboard goal percentage', () => {
  it('is 0% with no goals', async () => expect(await shown([])).toBe('0%'));

  it('is the mean of each goal\'s own canonical progress, not a milestone-weighted figure', async () => {
    const goals: LifeGoal[] = [
      // Ten completed milestones would dominate the old sub-goal-weighted figure; they must not count.
      { ...common, id: 'a', type: 'binary', completed: false, milestones: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, title: 't', completed: true })) },
      { ...common, id: 'b', type: 'count', target: 10, current: 10 },
      { ...common, id: 'c', type: 'duration', target: 100, current: 50 },
    ];
    // (0 + 1 + 0.5) / 3 = 50%. The old rule would have shown 100%.
    expect(await shown(goals)).toBe('50%');
  });

  it('counts a goal above target as 100% and a completed binary goal as 100%', async () => {
    expect(await shown([
      { ...common, id: 'a', type: 'count', target: 2, current: 9 },
      { ...common, id: 'b', type: 'binary', completed: true },
    ])).toBe('100%');
  });
});

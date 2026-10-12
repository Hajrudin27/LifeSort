import fs from 'fs';
import path from 'path';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

/**
 * Life tab navigation: the last actions must clear the floating tab bar, and Gifts surfaces among
 * the Life module cards only when the user has it on AND its effective availability allows
 * navigation (compiled default, with the server kill switch laid on top).
 */
let mockInsetBottom = 0;
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: mockInsetBottom, left: 0, right: 0 }),
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

import { router as mockRouter } from 'expo-router';

import LifeScreen from '@/app/(tabs)/life';
import {
  FLOATING_TAB_BAR_HEIGHT,
  floatingTabBarBottomOffset,
  floatingTabBarClearance,
} from '@/hooks/useFloatingTabBarClearance';
import i18n from '@/localization/i18n';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { useModuleFlagsStore } from '@/store/useModuleFlagsStore';

const t = (key: string) => i18n.t(key);
let tree: TestRenderer.ReactTestRenderer | undefined;

const render = async () => {
  await act(async () => { tree = TestRenderer.create(<LifeScreen />); });
};
const texts = () => tree!.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const cardFor = (title: string) =>
  tree!.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      node.findAllByType(Text).some((text) => [text.props.children].flat().join('') === title),
  )[0];
const scrollPaddingBottom = () => {
  const style = StyleSheet.flatten(tree!.root.findByType(ScrollView).props.contentContainerStyle);
  return style.paddingBottom as number;
};

beforeEach(async () => {
  mockInsetBottom = 0;
  (mockRouter.push as jest.Mock).mockClear();
  await i18n.changeLanguage('en');
  useEnabledModulesStore.setState({ enablement: {} });
  useModuleFlagsStore.setState({ overrides: {} });
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; });

describe('floatingTabBarClearance', () => {
  it('clears the bar footprint (bottom offset + height) for every safe-area inset', () => {
    for (const inset of [0, 10, 20, 34, 40]) {
      const barTop = floatingTabBarBottomOffset(inset) + FLOATING_TAB_BAR_HEIGHT;
      expect(floatingTabBarClearance(inset)).toBeGreaterThan(barTop);
    }
  });

  it('grows with the inset, so a notch iPhone reserves more than a device without one', () => {
    expect(floatingTabBarClearance(34)).toBeGreaterThan(floatingTabBarClearance(0));
  });

  it('is more than the fixed 72pt that used to hide the Modules launcher', () => {
    expect(floatingTabBarClearance(34)).toBeGreaterThan(72);
    expect(floatingTabBarClearance(0)).toBeGreaterThan(72);
  });
});

describe('FloatingTabBar shares the clearance geometry', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../components/FloatingTabBar.tsx'), 'utf8');

  it('takes its bottom offset and resting height from the same module the Life screen reads', () => {
    expect(source).toContain("from '@/hooks/useFloatingTabBarClearance'");
    expect(source).toMatch(/floatingTabBarBottomOffset\(insets\.bottom\)/);
    expect(source).toMatch(/outputRange: \[FLOATING_TAB_BAR_HEIGHT, \d+\]/);
    expect(source).not.toMatch(/insets\.bottom\s*\+\s*\d/);
  });

  it('keeps the resting bar at 72pt, so the clearance still describes the bar that is drawn', () => {
    expect(FLOATING_TAB_BAR_HEIGHT).toBe(72);
  });
});

describe('Life screen bottom spacing', () => {
  it('reserves the bar clearance for the device inset beneath the Modules launcher', async () => {
    mockInsetBottom = 34;
    await render();
    expect(scrollPaddingBottom()).toBe(floatingTabBarClearance(34));
    expect(texts().at(-1)).toBe(t('modules.launcherTitle'));
  });

  it('follows a different inset', async () => {
    mockInsetBottom = 0;
    await render();
    expect(scrollPaddingBottom()).toBe(floatingTabBarClearance(0));
  });
});

describe('Gifts on the Life module list', () => {
  it('is hidden while the module is internal for a public viewer, even though the user has it on', async () => {
    await render();
    expect(cardFor(t('modules.names.gifts'))).toBeUndefined();
  });

  it('appears and routes to /gifts when effectively available and enabled', async () => {
    useModuleFlagsStore.setState({ overrides: { gifts: 'available' } });
    await render();
    const card = cardFor(t('modules.names.gifts'));
    expect(card).toBeDefined();
    expect(texts()).toContain(t('modules.descriptions.gifts'));
    act(() => card!.props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith('/gifts');
  });

  it('does not appear when the user has switched it off', async () => {
    useModuleFlagsStore.setState({ overrides: { gifts: 'available' } });
    useEnabledModulesStore.setState({ enablement: { gifts: false } });
    await render();
    expect(cardFor(t('modules.names.gifts'))).toBeUndefined();
  });

  it('is hidden again by a server kill switch', async () => {
    useModuleFlagsStore.setState({ overrides: { gifts: 'hidden' } });
    await render();
    expect(cardFor(t('modules.names.gifts'))).toBeUndefined();
  });

  it('leaves the existing Life module cards unaffected', async () => {
    useModuleFlagsStore.setState({ overrides: { gifts: 'available' } });
    await render();
    for (const key of ['todosLabel', 'lifeGoalsLabel', 'habitsLabel', 'householdLabel', 'careerLabel']) {
      expect(cardFor(t(`life.${key}`))).toBeDefined();
    }
  });

  it('keeps the existing cards when Gifts stays dark', async () => {
    await render();
    for (const key of ['todosLabel', 'lifeGoalsLabel', 'habitsLabel', 'householdLabel', 'careerLabel']) {
      expect(cardFor(t(`life.${key}`))).toBeDefined();
    }
  });
});

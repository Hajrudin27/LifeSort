import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StorageStartupFailure from '@/components/StorageStartupFailure';
import Colors from '@/constants/Colors';
import i18n from '@/localization/i18n';
import en from '@/localization/locales/en/common.json';
import da from '@/localization/locales/da/common.json';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
}));
// The pre-hydration failure surface must not import persisted theme state.
jest.mock('@/store/useThemeStore', () => { throw new Error('Theme storage is unavailable during startup failure'); });

it.each(['light', 'dark', null] as const)('uses system appearance %s without persisted theme, with readable scalable DA/EN copy', async (scheme) => {
  jest.spyOn(require('react-native'), 'useColorScheme').mockReturnValue(scheme);
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  for (const [language, copy] of [['en', en], ['da', da]] as const) {
    await i18n.changeLanguage(language);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<StorageStartupFailure />); });
    try {
      const safeArea = tree.root.findByType(SafeAreaView);
      expect(StyleSheet.flatten(safeArea.props.style).backgroundColor).toBe(colors.background);
      const message = tree.root.findByType(Text);
      expect(message.props.children).toBe(copy.localDataUnavailable);
      expect(message.props.accessibilityRole).toBe('alert');
      expect(message.props.allowFontScaling).toBe(true);
      expect(message.props.numberOfLines).toBeUndefined();
      expect(message.props.maxFontSizeMultiplier).toBeUndefined();
      expect(StyleSheet.flatten(message.props.style)).toMatchObject({ color: colors.text });
      expect(StyleSheet.flatten(message.props.style).height).toBeUndefined();
      expect(StyleSheet.flatten(message.props.style).maxHeight).toBeUndefined();
      expect(tree.root.findByType(ScrollView)).toBeDefined();
      expect(tree.root.findAll((node) => node.props.accessibilityRole === 'button')).toHaveLength(0);
    } finally { act(() => tree.unmount()); }
  }
  jest.restoreAllMocks();
});

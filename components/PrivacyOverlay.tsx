import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet, View } from 'react-native';

import { useThemeColor } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

/**
 * Dækker skærmen, så snart appen ikke længere er i forgrunden.
 *
 * Både iOS og Android tager et øjebliksbillede af appen, når den forlades — det
 * er billedet, der vises i app-skifteren. Uden det her overlay ville billedet
 * indeholde det, brugeren sidst kiggede på: økonomi, cyklus, helbred. App-låsen
 * hjælper ikke, for den træder først i kraft, når appen åbnes igen.
 *
 * Overlayet skal rendere allerede ved `inactive`, ikke først ved `background`.
 * På iOS tages billedet nemlig under den overgang, og venter man til
 * `background`, er man for sent på den.
 */
export default function PrivacyOverlay() {
  const backgroundColor = useThemeColor({}, 'background');
  const accentTints = useAccentTints();
  const [isForeground, setIsForeground] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      setIsForeground(next === 'active');
    });
    return () => subscription.remove();
  }, []);

  if (isForeground) return null;

  return (
    <View style={[styles.container, { backgroundColor }]} pointerEvents="none">
      <View style={[styles.iconCircle, { backgroundColor: accentTints.accentSoft }]}>
        <SymbolView
          name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }}
          size={32}
          tintColor={accentTints.accent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Skal ligge over alt andet, inklusive låseskærmen.
    zIndex: 1000,
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
});

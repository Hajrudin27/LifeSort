import { SymbolView } from 'expo-symbols';
import { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

type Props = {
  color: string; // hero'ens baggrundsfarve (typisk accentTints.accent)
  icon: { ios: string; android: string; web: string };
  kicker: string;
  value: string;
  children?: ReactNode; // ekstra indhold under selve tallet — sammenligning, fremgangsbjælke, antal osv.
  style?: object;
};

// Den gennemgående "farvet hero med to bløde dekorative cirkler, ikon-cirkel,
// kicker-label og stort tal"-stil, brugt på tværs af Garantier, Sparemål,
// Udgifter, Rejse, Pakkeliste m.fl.
export default function Hero({ color, icon, kicker, value, children, style }: Props) {
  return (
    <View style={[styles.hero, { backgroundColor: color }, style]}>
      <View style={[styles.circleLarge, { backgroundColor: '#FFFFFF' }]} />
      <View style={[styles.circleSmall, { backgroundColor: '#FFFFFF' }]} />

      <View style={styles.topRow}>
        <View style={styles.iconCircle}>
          <SymbolView name={icon as any} size={20} tintColor="#FFFFFF" />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.value}>{value}</Text>
        </View>
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    padding: 20,
    gap: 4,
    position: 'relative',
    borderRadius: 20,
    overflow: 'hidden',
  },
  circleLarge: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -50,
    right: -40,
    opacity: 0.08,
  },
  circleSmall: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    bottom: -25,
    left: -15,
    opacity: 0.1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'transparent',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textGroup: { backgroundColor: 'transparent' },
  kicker: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.85,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    backgroundColor: 'transparent',
  },
  value: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    backgroundColor: 'transparent',
    marginTop: 2,
  },
});
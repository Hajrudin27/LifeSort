import { SymbolView } from 'expo-symbols';
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { useAccentTints } from '@/hooks/useAccentTints';
import { useBrandTints } from '@/hooks/useBrandTints';

type HeroIcon = { ios: string; android: string; web: string };

type Props = {
  // 'accent' = farvet kort med to bløde hvide cirkler, ikon-cirkel, kicker og stort tal.
  //            Bruges på oversigts-/listeskærme (Garantier, Rejse, Kommende udgifter, Mad).
  // 'brand'  = mørkt "ink"-kort med to farvede glød-cirkler, ikon, kicker, titel og undertekst.
  //            Bruges på opret-/flow-skærme (Ny opgave, Ny udgift, Ny garanti, Madplan).
  variant?: 'accent' | 'brand';

  // Kun 'accent': baggrundsfarve. Udelades = profilens accentfarve.
  color?: string;

  icon?: HeroIcon;
  leading?: ReactNode; // erstatter ikon-cirklen (fx en fremgangsring)
  kicker?: string;
  value?: string; // 'accent': det store tal
  valueSize?: number;
  title?: string; // 'brand': den store titel
  subtitle?: string; // 'brand'
  trailing?: ReactNode; // 'brand': badge eller knap i højre side af toprækken
  children?: ReactNode; // indhold under hero'ens hoved — piller, statistik, fremgang
  style?: StyleProp<ViewStyle>;
};

export default function Hero({
  variant = 'accent',
  color,
  icon,
  leading,
  kicker,
  value,
  valueSize,
  title,
  subtitle,
  trailing,
  children,
  style,
}: Props) {
  const accentTints = useAccentTints();
  const brand = useBrandTints();

  if (variant === 'brand') {
    return (
      <View style={[styles.brandHero, { backgroundColor: brand.ink }, style]}>
        <View style={[styles.glowPrimary, { backgroundColor: brand.glowPrimary }]} />
        <View style={[styles.glowSecondary, { backgroundColor: brand.glowSecondary }]} />

        <View style={styles.brandTopRow}>
          {leading ?? (
            icon ? (
              <View style={[styles.brandIcon, { backgroundColor: brand.veil }]}>
                <SymbolView name={icon as any} size={22} tintColor={brand.onBrand} />
              </View>
            ) : null
          )}
          {trailing}
        </View>

        {kicker ? <Text style={[styles.brandKicker, { color: brand.kickerOnBrand }]}>{kicker}</Text> : null}
        {title ? <Text style={[styles.brandTitle, { color: brand.onBrand }]}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.brandSubtitle, { color: brand.onBrand }]}>{subtitle}</Text> : null}

        {children}
      </View>
    );
  }

  return (
    <View style={[styles.accentHero, { backgroundColor: color ?? accentTints.accent }, style]}>
      <View style={[styles.circleLarge, { backgroundColor: brand.onBrand }]} />
      <View style={[styles.circleSmall, { backgroundColor: brand.onBrand }]} />

      <View style={styles.accentTopRow}>
        {leading ?? (
          icon ? (
            <View style={[styles.accentIcon, { backgroundColor: brand.veilStrong }]}>
              <SymbolView name={icon as any} size={20} tintColor={brand.onBrand} />
            </View>
          ) : null
        )}
        <View style={styles.accentTextGroup}>
          {kicker ? <Text style={[styles.accentKicker, { color: brand.onBrand }]}>{kicker}</Text> : null}
          {value ? (
            <Text style={[styles.accentValue, { color: brand.onBrand }, valueSize ? { fontSize: valueSize } : null]}>
              {value}
            </Text>
          ) : null}
        </View>
      </View>

      {children}
    </View>
  );
}

// Badge i hero'ens toprække — typisk valuta, uge eller en påmindelses-markør.
export function HeroBadge({ children }: { children: ReactNode }) {
  const brand = useBrandTints();
  return <View style={[styles.badge, { backgroundColor: brand.veil }]}>{children}</View>;
}

export function HeroBadgeText({ children }: { children: ReactNode }) {
  const brand = useBrandTints();
  return <Text style={[styles.badgeText, { color: brand.onBrand }]}>{children}</Text>;
}

// Genbrugelig pille til hero-indhold (tællere, status, nøgletal).
export function HeroPill({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const brand = useBrandTints();
  return <View style={[styles.pill, { backgroundColor: brand.veilMedium }, style]}>{children}</View>;
}

export function HeroPillText({ children }: { children: ReactNode }) {
  const brand = useBrandTints();
  return <Text style={[styles.pillText, { color: brand.onBrand }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  // --- accent-variant ---
  accentHero: { padding: 20, gap: 4, position: 'relative', borderRadius: 20, overflow: 'hidden' },
  circleLarge: { position: 'absolute', width: 160, height: 160, borderRadius: 80, top: -50, right: -40, opacity: 0.08 },
  circleSmall: { position: 'absolute', width: 80, height: 80, borderRadius: 40, bottom: -25, left: -15, opacity: 0.1 },
  accentTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accentIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  accentTextGroup: { flex: 1 },
  accentKicker: { fontSize: 12, fontWeight: '700', opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.6 },
  accentValue: { fontSize: 28, fontWeight: '800', marginTop: 2 },

  // --- brand-variant ---
  brandHero: { borderRadius: 24, gap: 8, padding: 20, position: 'relative', overflow: 'hidden' },
  glowPrimary: { position: 'absolute', width: 190, height: 190, borderRadius: 95, top: -86, right: -58, opacity: 0.25 },
  glowSecondary: { position: 'absolute', width: 130, height: 130, borderRadius: 65, bottom: -48, left: -34, opacity: 0.18 },
  brandTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  brandKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  brandTitle: { fontSize: 27, fontWeight: '800' },
  brandSubtitle: { fontSize: 14, lineHeight: 20, opacity: 0.85 },

  badge: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  badgeText: { fontSize: 12, fontWeight: '800' },

  // --- delt ---
  pill: { borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '700' },
});

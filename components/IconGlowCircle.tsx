import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { View } from '@/components/Themed';

type Props = {
  icon: { ios: string; android: string; web: string };
  color: string; // baggrund på selve den solide, indre cirkel
  glowColor: string; // baggrund på den bløde, større cirkel bagved
  size?: number; // udvendig, samlet størrelse (glow-cirklens diameter)
  innerSize?: number; // den solide cirkels diameter
  iconSize?: number;
  iconTintColor?: string;
};

// Den gennemgående "ikon i en solid cirkel, med et blødt glow bagved"-stil,
// brugt på tværs af Garantier, Sparemål, Udgifter, Rejse m.fl.
export default function IconGlowCircle({
  icon,
  color,
  glowColor,
  size = 40,
  innerSize,
  iconSize = 17,
  iconTintColor = '#FFFFFF',
}: Props) {
  const resolvedInnerSize = innerSize ?? size - 6;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View style={[styles.glow, { width: size, height: size, borderRadius: size / 2, backgroundColor: glowColor }]} />
      <View
        style={[
          styles.inner,
          {
            width: resolvedInnerSize,
            height: resolvedInnerSize,
            borderRadius: resolvedInnerSize / 2,
            backgroundColor: color,
          },
        ]}
      >
        <SymbolView name={icon as any} size={iconSize} tintColor={iconTintColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  glow: { position: 'absolute' },
  inner: { alignItems: 'center', justifyContent: 'center' },
});
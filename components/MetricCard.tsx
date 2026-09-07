import { SymbolView } from 'expo-symbols';
import { Pressable, PressableProps, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type IconName = { ios: string; android: string; web: string };

type Props = PressableProps & {
  icon: IconName;
  label: string;
  value: string;
  helper?: string;
  tone?: string;
};

export default function MetricCard({ icon, label, value, helper, tone, style, ...props }: Props) {
  const accentTints = useAccentTints();
  const textMuted = useThemeColor({}, 'textMuted');
  const color = tone ?? accentTints.accent;

  return (
    <Pressable accessibilityRole="button" style={[styles.pressable, style as object]} {...props}>
      <Card style={[styles.card, { borderColor: `${color}33` }]}>
        <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}>
          <SymbolView name={icon as any} size={17} tintColor={color} />
        </View>
        <Text style={[styles.label, { color: textMuted }]}>{label}</Text>
        <Text style={styles.value} numberOfLines={1}>{value}</Text>
        {helper && <Text style={[styles.helper, { color: textMuted }]} numberOfLines={2}>{helper}</Text>}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { minWidth: 0 },
  card: { minHeight: 122, gap: 5, borderWidth: 1.5 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: { fontSize: 11, fontWeight: '700' },
  value: { fontSize: 18, fontWeight: '800' },
  helper: { fontSize: 11, lineHeight: 15 },
});

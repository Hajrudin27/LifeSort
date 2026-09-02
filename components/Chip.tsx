import { SymbolView } from 'expo-symbols';
import { Pressable, PressableProps, StyleSheet } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type IconName = { ios: string; android: string; web: string };

type Props = PressableProps & {
  label: string;
  active?: boolean;
  icon?: IconName;
  stacked?: boolean; // ikon over teksten, i stedet for ved siden af
};

export default function Chip({ label, active, icon, stacked, style, ...props }: Props) {
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const border = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');

  const iconColor = active ? '#FFFFFF' : border;

  return (
    <Pressable
      style={[
        styles.chip,
        stacked && styles.chipStacked,
        {
          backgroundColor: active ? tint : surfaceMuted,
          borderColor: active ? tint : border,
        },
        style as object,
      ]}
      {...props}>
      {icon && <SymbolView name={icon as any} size={stacked ? 20 : 16} tintColor={iconColor} />}
      <Text style={[styles.label, active && { color: '#FFFFFF', fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  chipStacked: {
    flexDirection: 'column',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 64,
    gap: 4,
  },
  label: { fontSize: 13, fontWeight: '600' },
});
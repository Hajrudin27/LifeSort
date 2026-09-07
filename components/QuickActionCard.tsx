import { SymbolView } from 'expo-symbols';
import { Pressable, PressableProps, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type IconName = { ios: string; android: string; web: string };

type Props = PressableProps & {
  icon: IconName;
  title: string;
  subtitle: string;
  actionLabel?: string;
  tone?: string;
};

export default function QuickActionCard({ icon, title, subtitle, actionLabel, tone, style, ...props }: Props) {
  const accentTints = useAccentTints();
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const color = tone ?? accentTints.accent;

  return (
    <Pressable style={style as object} {...props}>
      <Card style={[styles.card, { borderColor: `${color}33` }]}>
        <View style={[styles.iconCircle, { backgroundColor: `${color}18` }]}>
          <SymbolView name={icon as any} size={18} tintColor={color} />
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.title}>{title}</Text>
          <Text style={[styles.subtitle, { color: textMuted }]} numberOfLines={2}>{subtitle}</Text>
        </View>
        <View style={[styles.chevron, { borderColor }]}>
          {actionLabel ? (
            <Text style={[styles.actionLabel, { color }]}>{actionLabel}</Text>
          ) : (
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={14} tintColor={color} />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textGroup: { flex: 1, backgroundColor: 'transparent' },
  title: { fontSize: 15, fontWeight: '800' },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  chevron: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionLabel: { fontSize: 11, fontWeight: '800' },
});

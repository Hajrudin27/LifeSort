import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type IconName = { ios: string; android: string; web: string };

type Props = {
  icon: IconName;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ icon, title, subtitle, actionLabel, onAction }: Props) {
  const accentTints = useAccentTints();
  const textMuted = useThemeColor({}, 'textMuted');

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: accentTints.accentSoft }]}>
        <SymbolView name={icon as any} size={26} tintColor={accentTints.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: textMuted }]}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <Pressable onPress={onAction} style={[styles.actionButton, { backgroundColor: accentTints.accentSoft }]}>
          <Text style={[styles.actionText, { color: accentTints.accent }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontWeight: '700', fontSize: 15, textAlign: 'center' },
  subtitle: { fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  actionButton: { marginTop: 16, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  actionText: { fontWeight: '700', fontSize: 13 },
});
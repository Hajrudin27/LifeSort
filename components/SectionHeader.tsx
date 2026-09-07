import { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export default function SectionHeader({ eyebrow, title, subtitle, action }: Props) {
  const accentTints = useAccentTints();
  const textMuted = useThemeColor({}, 'textMuted');

  return (
    <View style={styles.wrap}>
      <View style={styles.textGroup}>
        {eyebrow && <Text style={[styles.eyebrow, { color: accentTints.accent }]}>{eyebrow}</Text>}
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={[styles.subtitle, { color: textMuted }]}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'transparent',
  },
  textGroup: { flex: 1, backgroundColor: 'transparent' },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  title: { fontSize: 20, fontWeight: '800' },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 3 },
});

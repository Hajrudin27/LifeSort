import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useProfileStore } from '@/store/useProfileStore';
import { TaskAssignee } from '@/types/household';

function initialsOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export function AssigneeAvatar({ assignee, size = 28 }: { assignee: TaskAssignee; size?: number }) {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const partnerName = useProfileStore((s) => s.profile.partnerName);
  const label = assignee === 'me' ? t('household.assignee.me') : partnerName || t('household.assignee.partner');
  const bg = assignee === 'me' ? accentTints.accent : accentTints.fertile ?? accentTints.accent;

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{initialsOf(label)}</Text>
    </View>
  );
}

type Props = {
  assignedTo: TaskAssignee;
  onChangeAssignee: (assignee: TaskAssignee) => void;
  rotates: boolean;
  onChangeRotates: (rotates: boolean) => void;
};

export default function AssigneeSelector({ assignedTo, onChangeAssignee, rotates, onChangeRotates }: Props) {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const border = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const partnerName = useProfileStore((s) => s.profile.partnerName);
  const partnerLabel = partnerName || t('household.assignee.partner');

  const options: { key: TaskAssignee; label: string }[] = [
    { key: 'me', label: t('household.assignee.me') },
    { key: 'partner', label: partnerLabel },
  ];

  return (
    <View>
      <Text style={styles.fieldLabel}>{t('household.assignedToLabel')}</Text>
      <View style={styles.row}>
        {options.map((opt) => {
          const active = assignedTo === opt.key;
          return (
            <Pressable
              accessibilityRole="button"
              key={opt.key}
              onPress={() => onChangeAssignee(opt.key)}
              style={[
                styles.assigneeButton,
                {
                  backgroundColor: active ? tint : surfaceMuted,
                  borderColor: active ? tint : border,
                },
              ]}
            >
              <AssigneeAvatar assignee={opt.key} size={24} />
              <Text style={[styles.assigneeLabel, active && styles.assigneeLabelActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => onChangeRotates(!rotates)}
        style={[
          styles.rotateRow,
          { borderColor: rotates ? tint : border, backgroundColor: rotates ? accentTints.accentSoft : surfaceMuted },
        ]}
      >
        <SymbolView
          name={{ ios: 'arrow.triangle.2.circlepath', android: 'sync', web: 'sync' }}
          size={16}
          tintColor={rotates ? tint : border}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rotateLabel, rotates && { color: tint }]}>{t('household.rotatesLabel')}</Text>
          <Text style={styles.rotateHint}>{t('household.rotatesHint')}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { fontWeight: '600', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  assigneeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  assigneeLabel: { fontSize: 14, fontWeight: '600' },
  assigneeLabelActive: { color: '#FFFFFF' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: '700' },
  rotateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rotateLabel: { fontSize: 13, fontWeight: '700' },
  rotateHint: { fontSize: 11, opacity: 0.6, marginTop: 1 },
});
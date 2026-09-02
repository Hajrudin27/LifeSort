import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import SwipeableRow from '@/components/SwipeableRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useCareerStore } from '@/store/useCareerStore';
import { ApplicationStatus } from '@/types/career';

const STATUS_COLORS: Record<ApplicationStatus, 'tint' | 'warning' | 'success' | 'danger'> = {
  applied: 'tint',
  interview: 'warning',
  offer: 'success',
  rejected: 'danger',
};

export default function ApplicationsScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const warning = useThemeColor({}, 'warning');
  const success = useThemeColor({}, 'success');
  const danger = useThemeColor({}, 'danger');

  const colorMap = { tint, warning, success, danger };

  const applications = useCareerStore((s) => s.applications);
  const removeApplication = useCareerStore((s) => s.removeApplication);
  const [search, setSearch] = useState('');

  const filtered = applications.filter((a) => {
    const q = search.trim().toLowerCase();
    return a.position.toLowerCase().includes(q) || a.company.toLowerCase().includes(q);
  });
  const sorted = [...filtered].sort((a, b) => b.appliedDate.localeCompare(a.appliedDate));

  return (
    <View style={sharedStyles.formContainer}>
      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t('career.searchPlaceholder')}
        placeholderTextColor={borderColor}
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('career.emptyState')}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <SwipeableRow onDelete={() => removeApplication(item.id)}>
            <Pressable onPress={() => router.push(`/career/applications/${item.id}`)}>
              <Card style={sharedStyles.rowBetween}>
                <View style={styles.textWrap}>
                  <Text style={styles.title}>{item.position}</Text>
                  <Text style={[styles.meta, { color: textMuted }]}>{item.company} · {item.appliedDate}</Text>
                </View>
                <Text style={[styles.status, { color: colorMap[STATUS_COLORS[item.status]] }]}>
                  {t(`career.status.${item.status}`)}
                </Text>
              </Card>
            </Pressable>
          </SwipeableRow>
        )}
      />

      <Button label={t('career.addButton')} onPress={() => router.push('/career/applications/new')} />
    </View>
  );
}

const styles = {
  textWrap: { flex: 1 },
  title: { fontWeight: '700' as const },
  meta: { fontSize: 13, marginTop: 2 },
  status: { fontSize: 13, fontWeight: '700' as const },
};
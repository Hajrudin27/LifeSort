import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import SwipeableRow from '@/components/SwipeableRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { sortApplications } from '@/features/career/domain/application';
import { useCareerStore } from '@/store/useCareerStore';
import { ApplicationStatus, JobApplication } from '@/types/career';

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
  const textColor = useThemeColor({}, 'text');
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

  // A text filter over the user's own list. It ranks nothing; the order is the domain's one order.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortApplications(
      applications.filter((a) => a.position.toLowerCase().includes(q) || a.company.toLowerCase().includes(q)),
    );
  }, [applications, search]);

  // Deletion is local and permanent: always ask first.
  const confirmDelete = (application: JobApplication) => {
    Alert.alert(t('career.deleteConfirmTitle'), t('career.deleteConfirmMessage'), [
      { text: t('career.cancel'), style: 'cancel' },
      { text: t('career.delete'), style: 'destructive', onPress: () => removeApplication(application.id) },
    ]);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
        accessibilityLabel={t('career.searchLabel')}
        placeholder={t('career.searchPlaceholder')}
        placeholderTextColor={textMuted}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        returnKeyType="search"
      />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>
              {applications.length === 0 ? t('career.emptyState') : t('career.noMatches')}
            </Text>
          </Card>
        }
        renderItem={({ item }) => (
          <SwipeableRow onDelete={() => confirmDelete(item)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.position}, ${item.company}, ${item.appliedDate}, ${t(`career.status.${item.status}`)}`}
              onPress={() => router.push(`/career/applications/${item.id}`)}>
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

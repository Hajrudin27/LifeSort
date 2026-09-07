import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import SwipeableRow from '@/components/SwipeableRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import Hero, { HeroPill, HeroPillText } from '@/components/Hero';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHomeBackTitle } from '@/hooks/useHomeBackTitle';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { WarrantyType } from '@/types/warranty';
import { daysUntil } from '@/utils/shared/dateDays';
import { getWarrantyTypeIconName } from '@/utils/warranty/warrantyTypeIcon';

const TYPES: WarrantyType[] = ['insurance', 'rental', 'warranty', 'receipt', 'other'];

export default function WarrantiesScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const warning = useThemeColor({}, 'warning');
  const success = useThemeColor({}, 'success');

  const warranties = useWarrantiesStore((s) => s.warranties);
  const removeWarranty = useWarrantiesStore((s) => s.removeWarranty);
  const [groupByType, setGroupByType] = useState(false);
  const [search, setSearch] = useState('');

  const expiringSoonCount = warranties.filter((w) => {
    const d = daysUntil(w.expiryDate);
    return d >= 0 && d <= 30;
  }).length;
  const expiredCount = warranties.filter((w) => daysUntil(w.expiryDate) < 0).length;

  const filtered = warranties.filter((w) => w.name.toLowerCase().includes(search.trim().toLowerCase()));

  const sortedByDate = [...filtered].sort(
    (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
  );

  const sections = groupByType
    ? TYPES.map((type) => ({
        title: t(`warranties.types.${type}`),
        data: sortedByDate.filter((w) => w.type === type),
      })).filter((section) => section.data.length > 0)
    : [{ title: '', data: sortedByDate }];

  const statusColor = (days: number) => {
    if (days < 0) return danger;
    if (days <= 30) return warning;
    return success;
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Hero
        icon={{ ios: 'shield.lefthalf.filled', android: 'shield', web: 'shield' }}
        kicker={t('warranties.screenTitle')}
        value={String(warranties.length)}
        valueSize={32}
        style={styles.hero}
      >
        {(expiringSoonCount > 0 || expiredCount > 0) && (
          <View style={styles.heroStatsRow}>
            {expiringSoonCount > 0 && (
              <HeroPill>
                <HeroPillText>{t('warranties.expiringSoonTitle')}: {expiringSoonCount}</HeroPillText>
              </HeroPill>
            )}
            {expiredCount > 0 && (
              <HeroPill>
                <HeroPillText>{t('warranties.expired')}: {expiredCount}</HeroPillText>
              </HeroPill>
            )}
          </View>
        )}
      </Hero>

      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t('warranties.searchPlaceholder')}
        placeholderTextColor={borderColor}
        value={search}
        onChangeText={setSearch}
      />

      <View style={sharedStyles.chipRow}>
        <Chip label={t('warranties.sortByDate')} active={!groupByType} onPress={() => setGroupByType(false)} />
        <Chip label={t('warranties.sortByType')} active={groupByType} onPress={() => setGroupByType(true)} />
      </View>

      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <EmptyState
            icon={{ ios: 'shield.fill', android: 'shield', web: 'shield' }}
            title={t('warranties.emptyState')}
            actionLabel={t('warranties.addButton')}
            onAction={() => router.push('/warranties/new')}
          />
        }
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={sharedStyles.sectionLabel}>{section.title}</Text> : null
        }
        renderItem={({ item }) => {
          const days = daysUntil(item.expiryDate);
          const isExpired = days < 0;
          const color = statusColor(days);

          return (
            <SwipeableRow onDelete={() => removeWarranty(item.id)}>
              <Pressable onPress={() => router.push(`/warranties/${item.id}`)}>
                <Card style={[styles.card, { borderColor: accentTints.accentSoft }]}>
                  <View style={styles.iconWrap}>
                    <View style={[styles.iconGlow, { backgroundColor: accentTints.accentSoft }]} />
                    <View style={[styles.iconCircle, { backgroundColor: accentTints.accent }]}>
                      <SymbolView name={getWarrantyTypeIconName(item.type) as any} size={16} tintColor="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.cardText}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={{ color: textMuted, fontSize: 12 }}>{t(`warranties.types.${item.type}`)}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: color + '22' }]}>
                    <Text style={[styles.statusText, { color }]}>
                      {isExpired ? t('warranties.expired') : t('warranties.expiresIn', { days })}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            </SwipeableRow>
          );
        }}
      />

      <Button label={t('warranties.addButton')} onPress={() => router.push('/warranties/new')} />
    </View>
  );
}

const styles = {
  hero: {
    marginBottom: 4,
    shadowColor: '#3B2C24',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  heroStatsRow: { flexDirection: 'row' as const, gap: 8, marginTop: 14, flexWrap: 'wrap' as const, backgroundColor: 'transparent' },
  card: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, borderWidth: 1.5, marginBottom: 2 },
  iconWrap: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const },
  iconGlow: { position: 'absolute' as const, width: 34, height: 34, borderRadius: 17 },
  iconCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
  cardText: { flex: 1 },
  name: { fontWeight: '700' as const, fontSize: 15 },
  statusPill: { borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8 },
  statusText: { fontSize: 11, fontWeight: '800' as const },
};
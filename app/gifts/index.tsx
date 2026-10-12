import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, SectionList, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import SwipeableRow from '@/components/SwipeableRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import type { MinorUnits } from '@/core/money/minorUnits';
import { partitionGifts } from '@/features/gifts/domain/gift';
import { useGiftsStore } from '@/store/useGiftsStore';
import type { Gift } from '@/types/gift';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * A calendar date as text for the reader's language. Built in UTC from the date's own digits, so
 * neither the device time zone nor a two-digit year can move or mis-read it.
 */
function formatDate(iso: string, language: string): string {
  const parts = parseCalendarDate(iso);
  if (!parts) return iso;
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return new Intl.DateTimeFormat(language === 'da' ? 'da-DK' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export default function GiftsScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');

  const gifts = useGiftsStore((s) => s.gifts);
  const removeGift = useGiftsStore((s) => s.removeGift);

  // Two sections, each in the domain's one order. Nothing is filtered, ranked or hidden.
  const sections = useMemo(() => {
    const { planned, purchased } = partitionGifts(gifts);
    return [
      { key: 'planned', data: planned },
      { key: 'purchased', data: purchased },
    ].filter((section) => section.data.length > 0);
  }, [gifts]);

  const money = (amount: MinorUnits) => formatDkk(amount, moneyLocaleFor(i18n.language));

  // Deletion is local and permanent: always ask first.
  const confirmDelete = (gift: Gift) => {
    Alert.alert(t('gifts.deleteConfirmTitle'), t('gifts.deleteConfirmMessage'), [
      { text: t('gifts.cancel'), style: 'cancel' },
      { text: t('gifts.delete'), style: 'destructive', onPress: () => removeGift(gift.id) },
    ]);
  };

  const rowDetails = (gift: Gift): string[] => [
    t('gifts.row.forPerson', { person: gift.personLabel }),
    ...(gift.occasionLabel !== undefined ? [gift.occasionLabel] : []),
    ...(gift.occasionDate !== undefined ? [formatDate(gift.occasionDate, i18n.language)] : []),
  ];
  const rowMoney = (gift: Gift): string[] => [
    ...(gift.budget !== undefined ? [t('gifts.row.budget', { amount: money(gift.budget) })] : []),
    ...(gift.purchasedOn !== undefined ? [t('gifts.row.purchasedOn', { date: formatDate(gift.purchasedOn, i18n.language) })] : []),
    ...(gift.paid !== undefined ? [t('gifts.row.paid', { amount: money(gift.paid) })] : []),
  ];

  return (
    <View style={sharedStyles.formContainer}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('gifts.emptyState')}</Text>
          </Card>
        }
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={sharedStyles.sectionLabel}>
            {t(section.key === 'planned' ? 'gifts.plannedSection' : 'gifts.purchasedSection')}
          </Text>
        )}
        renderItem={({ item }) => {
          const details = rowDetails(item);
          const amounts = rowMoney(item);
          return (
            <SwipeableRow onDelete={() => confirmDelete(item)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={[item.idea, ...details, ...amounts].join(', ')}
                accessibilityActions={[{ name: 'delete', label: t('gifts.delete') }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'delete') confirmDelete(item);
                }}
                onPress={() => router.push(`/gifts/${item.id}`)}
                style={styles.row}>
                <Card style={sharedStyles.rowBetween}>
                  <View style={styles.textWrap}>
                    <Text style={styles.title}>{item.idea}</Text>
                    <Text style={[styles.meta, { color: textMuted }]}>{details.join(' · ')}</Text>
                    {amounts.length > 0 && <Text style={[styles.meta, { color: textMuted }]}>{amounts.join(' · ')}</Text>}
                  </View>
                </Card>
              </Pressable>
            </SwipeableRow>
          );
        }}
      />

      <Button label={t('gifts.addButton')} onPress={() => router.push('/gifts/new')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44 },
  textWrap: { flex: 1, gap: 2 },
  title: { fontWeight: '700' },
  meta: { fontSize: 13 },
});

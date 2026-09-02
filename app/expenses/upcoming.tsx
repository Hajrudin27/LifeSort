import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useExpensesStore } from '@/store/useExpensesStore';
import { getCategoryIconName } from '@/utils/expense/expenseCategoryIcon';
import { getCategoryLabel } from '@/utils/expense/expenseCategoryLabel';
import { daysUntil } from '@/utils/shared/dateDays';

const WINDOW_DAYS = 7;

export default function UpcomingExpensesScreen() {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const warning = useThemeColor({}, 'warning');
  const success = useThemeColor({}, 'success');

  const allExpenses = useExpensesStore((s) => s.expenses);

  const upcoming = allExpenses
    .map((e) => ({ ...e, days: daysUntil(e.nextPaymentDate) }))
    .filter((e) => e.days >= 0 && e.days <= WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);

  const totalUpcoming = upcoming.reduce((sum, e) => sum + e.amount, 0);

  const today = upcoming.filter((e) => e.days === 0);
  const tomorrow = upcoming.filter((e) => e.days === 1);
  const restOfWeek = upcoming.filter((e) => e.days > 1);

  const sections = [
    ...(today.length > 0 ? [{ title: t('expenses.dueToday'), data: today }] : []),
    ...(tomorrow.length > 0 ? [{ title: t('expenses.dueTomorrow'), data: tomorrow }] : []),
    ...(restOfWeek.length > 0 ? [{ title: t('expenses.restOfWeek'), data: restOfWeek }] : []),
  ];

  const urgencyColor = (days: number) => {
    if (days === 0) return danger;
    if (days <= 2) return warning;
    return success;
  };

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { backgroundColor: accentTints.accent, overflow: 'hidden' }]}>
        <View style={[styles.heroCircleLarge, { backgroundColor: '#FFFFFF', opacity: 0.08 }]} />
        <View style={[styles.heroCircleSmall, { backgroundColor: '#FFFFFF', opacity: 0.1 }]} />

        <View style={styles.heroTopRow}>
          <View style={styles.heroIconCircle}>
            <SymbolView name={{ ios: 'calendar.badge.clock', android: 'event', web: 'event' }} size={20} tintColor="#FFFFFF" />
          </View>
          <View style={styles.heroTextGroup}>
            <Text style={styles.heroKicker}>{t('expenses.upcomingHeroKicker', { days: WINDOW_DAYS })}</Text>
            <Text style={styles.heroAmount}>{totalUpcoming.toFixed(0)} kr.</Text>
          </View>
        </View>

        <View style={styles.heroCountPill}>
          <Text style={styles.heroCountText}>{t('expenses.upcomingHeroCount', { count: upcoming.length })}</Text>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: accentTints.accentSoft }]}>
            <View style={[styles.emptyIconCircle, { backgroundColor: accentTints.accent }]}>
              <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={22} tintColor="#FFFFFF" />
            </View>
            <Text style={styles.emptyTitle}>{t('expenses.allClearTitle')}</Text>
            <Text style={{ color: textMuted, textAlign: 'center', marginTop: 2 }}>{t('expenses.noUpcoming')}</Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionKicker, { backgroundColor: accentTints.accentSoft }]}>
            <Text style={[styles.sectionKickerText, { color: accentTints.accent }]}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const color = urgencyColor(item.days);
          return (
            <Pressable onPress={() => router.push(`/expenses/edit/${item.id}`)}>
              <View style={[styles.row, { borderColor: accentTints.accentSoft }]}>
                <View style={styles.iconWrap}>
                  <View style={[styles.iconGlow, { backgroundColor: color + '22' }]} />
                  <View style={[styles.iconCircle, { backgroundColor: color }]}>
                    <SymbolView name={getCategoryIconName(item.category) as any} size={16} tintColor="#FFFFFF" />
                  </View>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={{ color: textMuted, fontSize: 12 }}>{getCategoryLabel(item.category, t)}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.rowAmount}>{item.amount.toFixed(0)} kr.</Text>
                  <View style={[styles.daysBadge, { backgroundColor: color + '22' }]}>
                    <Text style={[styles.daysBadgeText, { color }]}>
                      {item.days === 0 ? t('expenses.dueToday') : item.days === 1 ? t('expenses.dueTomorrow') : t('expenses.dueIn', { days: item.days })}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  hero: { borderRadius: 20, padding: 20, gap: 4, position: 'relative' },
  heroCircleLarge: { position: 'absolute', width: 160, height: 160, borderRadius: 80, top: -50, right: -40 },
  heroCircleSmall: { position: 'absolute', width: 80, height: 80, borderRadius: 40, bottom: -25, left: -15 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'transparent' },
  heroIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextGroup: { backgroundColor: 'transparent' },
  heroKicker: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.6, backgroundColor: 'transparent' },
  heroAmount: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', backgroundColor: 'transparent', marginTop: 2 },
  heroCountPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 14,
  },
  heroCountText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  list: { gap: 8, paddingBottom: 32 },
  emptyCard: { alignItems: 'center', borderRadius: 20, padding: 32, marginTop: 8 },
  emptyIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontWeight: '800', fontSize: 16 },
  sectionKicker: { alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12, marginTop: 10, marginBottom: 6 },
  sectionKickerText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 16, padding: 12, marginBottom: 4 },
  iconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconGlow: { position: 'absolute', width: 36, height: 36, borderRadius: 18 },
  iconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  rowName: { fontWeight: '700', fontSize: 14 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowAmount: { fontWeight: '800', fontSize: 14 },
  daysBadge: { borderRadius: 10, paddingVertical: 3, paddingHorizontal: 7 },
  daysBadgeText: { fontSize: 10, fontWeight: '800' },
});
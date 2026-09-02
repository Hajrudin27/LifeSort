import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, TextInput } from 'react-native';

import ProgressBar from '@/components/ProgressBar';
import RingProgress from '@/components/RingProgress';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHomeBackTitle } from '@/hooks/useHomeBackTitle';
import { useTripsStore } from '@/store/useTripsStore';
import { daysUntil } from '@/utils/shared/dateDays';

const PLANNING_WINDOW_DAYS = 90;
const CURRENT_YEAR = new Date().getFullYear();

export default function TravelScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const success = useThemeColor({}, 'success');
  const trips = useTripsStore((s) => s.trips);
  const removeTrip = useTripsStore((s) => s.removeTrip);
  const packingItems = useTripsStore((s) => s.packingItems);
  const tripExpenses = useTripsStore((s) => s.expenses);
  const [search, setSearch] = useState('');

  const filtered = trips.filter((tr) => tr.name.toLowerCase().includes(search.trim().toLowerCase()));

  const upcoming = filtered
    .filter((tr) => daysUntil(tr.endDate) >= 0)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const past = filtered
    .filter((tr) => daysUntil(tr.endDate) < 0)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const sections = [
    ...(upcoming.length > 0 ? [{ title: t('travel.upcomingTripsLabel'), data: upcoming }] : []),
    ...(past.length > 0 ? [{ title: t('travel.pastTripsLabel'), data: past }] : []),
  ];

  // Total på tværs af alle rejser, der starter i indeværende år
  const tripsThisYear = trips.filter((tr) => tr.startDate.slice(0, 4) === String(CURRENT_YEAR));
  const tripIdsThisYear = new Set(tripsThisYear.map((tr) => tr.id));
  const totalSpentThisYear = tripExpenses
    .filter((e) => tripIdsThisYear.has(e.tripId))
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <View style={sharedStyles.formContainer}>
      {trips.length > 0 && (
        <View style={[styles.hero, { backgroundColor: accentTints.accent, overflow: 'hidden' }]}>
          <View style={[styles.heroCircleLarge, { backgroundColor: '#FFFFFF', opacity: 0.08 }]} />
          <View style={[styles.heroCircleSmall, { backgroundColor: '#FFFFFF', opacity: 0.1 }]} />

          <View style={styles.heroTopRow}>
            <View style={styles.heroIconCircle}>
              <SymbolView name={{ ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' }} size={20} tintColor="#FFFFFF" />
            </View>
            <View style={styles.heroTextGroup}>
              <Text style={styles.heroKicker}>{t('travel.totalSpentLabel', { year: CURRENT_YEAR })}</Text>
              <Text style={styles.heroAmount}>{totalSpentThisYear.toFixed(0)} kr.</Text>
            </View>
          </View>

          <View style={styles.heroCountPill}>
            <Text style={styles.heroCountText}>{t('travel.tripsCountThisYear', { count: tripsThisYear.length })}</Text>
          </View>
        </View>
      )}

      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t('travel.searchPlaceholder')}
        placeholderTextColor={borderColor}
        value={search}
        onChangeText={setSearch}
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: accentTints.accentSoft }]}>
            <SymbolView name={{ ios: 'airplane', android: 'flight', web: 'flight' }} size={28} tintColor={accentTints.accent} />
            <Text style={{ color: textMuted, marginTop: 8 }}>{t('travel.emptyState')}</Text>
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={sharedStyles.sectionLabel}>{section.title}</Text>}
        renderItem={({ item }) => {
          const daysUntilStart = daysUntil(item.startDate);
          const daysUntilEnd = daysUntil(item.endDate);
          const isPast = daysUntilEnd < 0;
          const isOngoing = !isPast && daysUntilStart <= 0;

          const statusColor = isPast ? textMuted : isOngoing ? success : accentTints.accent;

          const progress = isOngoing
            ? 1
            : Math.min(Math.max(1 - daysUntilStart / PLANNING_WINDOW_DAYS, 0), 1);

          const itemsForTrip = packingItems.filter((p) => p.tripId === item.id);
          const packedCount = itemsForTrip.filter((p) => p.checked).length;
          const packingProgress = itemsForTrip.length > 0 ? packedCount / itemsForTrip.length : null;

          return (
            <Pressable onPress={() => router.push({ pathname: '/travel/[id]', params: { id: item.id } })}>
              <View style={[styles.card, { borderColor: accentTints.accentSoft }, isPast && styles.cardPast]}>
                <View style={styles.cardTopRow}>
                  <View style={styles.ringWrap}>
                    <RingProgress progress={progress} size={44} strokeWidth={4} showLabel={false} />
                    <View style={styles.ringCenterIcon}>
                      <SymbolView
                        name={{
                          ios: isPast ? 'checkmark' : isOngoing ? 'location.fill' : 'airplane',
                          android: isPast ? 'check' : isOngoing ? 'location_on' : 'flight',
                          web: isPast ? 'check' : isOngoing ? 'location_on' : 'flight',
                        }}
                        size={14}
                        tintColor={statusColor}
                      />
                    </View>
                  </View>

                  <View style={styles.cardText}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={{ color: textMuted, fontSize: 12 }}>
                      {item.startDate} → {item.endDate}
                    </Text>
                  </View>

                  <View style={[styles.statusPill, { backgroundColor: statusColor + '22' }]}>
                    <Text style={[styles.statusText, { color: statusColor }]}>
                      {isPast
                        ? t('travel.ongoingOrPast')
                        : isOngoing
                          ? t('travel.daysLeft', { days: daysUntilEnd })
                          : t('travel.daysUntil', { days: daysUntilStart })}
                    </Text>
                  </View>
                </View>

                {!isPast && packingProgress !== null && (
                  <View style={styles.packingRow}>
                    <SymbolView name={{ ios: 'bag.fill', android: 'luggage', web: 'luggage' }} size={12} tintColor={textMuted} />
                    <View style={styles.packingBarWrap}>
                      <ProgressBar progress={packingProgress} />
                    </View>
                    <Text style={{ color: textMuted, fontSize: 11, fontWeight: '700' }}>
                      {packedCount}/{itemsForTrip.length}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable style={[styles.addButton, { backgroundColor: accentTints.accent }]} onPress={() => router.push('/travel/new')}>
        <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor="#FFFFFF" />
        <Text style={styles.addButtonText}>{t('travel.addButton')}</Text>
      </Pressable>
    </View>
  );
}

const styles = {
  hero: { padding: 20, gap: 4, position: 'relative' as const, borderRadius: 20, marginBottom: 4 },
  heroCircleLarge: { position: 'absolute' as const, width: 160, height: 160, borderRadius: 80, top: -50, right: -40 },
  heroCircleSmall: { position: 'absolute' as const, width: 80, height: 80, borderRadius: 40, bottom: -25, left: -15 },
  heroTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, backgroundColor: 'transparent' },
  heroIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  heroTextGroup: { backgroundColor: 'transparent' },
  heroKicker: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' as const, opacity: 0.85, textTransform: 'uppercase' as const, letterSpacing: 0.6, backgroundColor: 'transparent' },
  heroAmount: { fontSize: 28, fontWeight: '800' as const, color: '#FFFFFF', backgroundColor: 'transparent', marginTop: 2 },
  heroCountPill: {
    alignSelf: 'flex-start' as const,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 14,
  },
  heroCountText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' as const },
  emptyCard: { alignItems: 'center' as const, borderRadius: 20, padding: 32 },
  card: {
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 14,
    marginBottom: 4,
  },
  cardPast: { opacity: 0.6 },
  cardTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  ringWrap: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  ringCenterIcon: { position: 'absolute' as const },
  cardText: { flex: 1, gap: 2 },
  name: { fontWeight: '800' as const, fontSize: 15 },
  statusPill: { borderRadius: 10, paddingVertical: 4, paddingHorizontal: 8, maxWidth: 100 },
  statusText: { fontSize: 11, fontWeight: '800' as const, textAlign: 'center' as const },
  packingRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginLeft: 56 },
  packingBarWrap: { flex: 1 },
  addButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
  },
  addButtonText: { color: '#FFFFFF', fontWeight: '700' as const, fontSize: 16 },
};
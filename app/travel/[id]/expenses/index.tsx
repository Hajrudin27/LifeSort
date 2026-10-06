import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import {
  canResolveLegacyTripExpense,
  legacyResolutionPending,
  projectionVisibleTo,
  settledTripSpend,
  tripSpendFreshness,
} from '@/features/travel/financialReadContract';
import { useAuthStore } from '@/store/useAuthStore';
import { useTripsStore } from '@/store/useTripsStore';
import type { TripExpense, TripExpenseCategory, TripFinancialProjection } from '@/types/trip';
import { getTripCategoryLabel } from '@/utils/trip/tripExpenseCategoryLabel';

const CATEGORIES: TripExpenseCategory[] = ['flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other'];
type Row = { kind: 'canonical'; value: TripFinancialProjection } | { kind: 'legacy'; value: TripExpense };

export default function TripExpensesScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const textMuted = useThemeColor({}, 'textMuted');
  const warning = useThemeColor({}, 'warning');
  const success = useThemeColor({}, 'success');
  const locale = moneyLocaleFor(i18n.language);

  const trip = useTripsStore((s) => s.trips.find((candidate) => candidate.id === id));
  const legacyExpenses = useTripsStore((s) => s.expenses).filter((expense) => expense.tripId === id);
  const allProjections = useTripsStore((s) => s.financialProjections);
  const freshAt = useTripsStore((s) => s.financialProjectionFreshAt);
  const statuses = useTripsStore((s) => s.financialProjectionStatus);
  const myUserId = useTripsStore((s) => s.myUserId);
  const sessionUserId = useAuthStore((s) => s.session?.user.id);
  const refresh = useTripsStore((s) => s.refreshTripFinancialProjection);
  const [category, setCategory] = useState<TripExpenseCategory | undefined>();

  useEffect(() => { if (id) void refresh(id); }, [id, refresh]);

  // The cache is shown only to the account it belongs to (a session can switch accounts
  // without a local cleanup); anyone else sees no snapshot at all.
  const projectionsVisible = projectionVisibleTo(myUserId, sessionUserId);
  const projections = projectionsVisible ? allProjections.filter((projection) => projection.tripId === id) : [];
  const spendFreshness = id && projectionsVisible ? tripSpendFreshness([id], freshAt, statuses) : 'unavailable';
  // Saved rows whose attachments are still being handed to Economy are not unresolved.
  const pendingHandoff = (expense: TripExpense) => legacyResolutionPending(expense.id, projections, sessionUserId);
  const unresolvedCount = legacyExpenses.filter((expense) => !pendingHandoff(expense)).length;
  const visibleProjections = projections.filter((projection) => category === undefined || projection.category === category);
  const visibleLegacy = legacyExpenses.filter((expense) => category === undefined || expense.category === category);
  const rows: Row[] = [
    ...visibleProjections.map((value): Row => ({ kind: 'canonical', value })),
    ...visibleLegacy.map((value): Row => ({ kind: 'legacy', value })),
  ];
  const total = useMemo(() => {
    // Before any snapshot exists the spend is unknown, not zero.
    if (spendFreshness === 'unavailable') return null;
    try { return settledTripSpend(visibleProjections); } catch { return null; }
  }, [visibleProjections, spendFreshness]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: trip?.name ?? t('travel.expensesLabel') }} />

      <Text style={styles.total}>
        {total === null ? t('travel.spendUnavailable') : formatDkk(total, locale)}
      </Text>
      <Text style={[styles.settledLabel, { color: textMuted }]}>{t('travel.settledSpendLabel')}</Text>
      {total !== null && spendFreshness === 'stale' && (
        <Text accessibilityRole="alert" style={[styles.status, { color: warning }]}>{t('travel.financialProjectionStale')}</Text>
      )}
      {unresolvedCount > 0 && (
        <Text style={[styles.status, { color: warning }]}>
          {t('travel.unresolvedExpenseCount', { count: unresolvedCount })}
        </Text>
      )}

      <View style={styles.filters}>
        <Chip label={t('travel.allCategories')} active={category === undefined} onPress={() => setCategory(undefined)} />
        {CATEGORIES.map((value) => (
          <Chip key={value} label={t(`travel.categories.${value}`)} active={category === value} onPress={() => setCategory(value)} />
        ))}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => `${item.kind}:${item.kind === 'canonical' ? item.value.expenseId : item.value.id}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={[styles.empty, { color: textMuted }]}>{t('expenses.emptyState')}</Text>}
        renderItem={({ item }) => {
          if (item.kind === 'legacy') {
            const expense = item.value;
            // Fail closed: offered only to the row's proven author (APP-059 review #1).
            const canResolve = canResolveLegacyTripExpense(expense, trip, sessionUserId);
            const savedPendingAttachments = pendingHandoff(expense);
            const content = (
                <Card style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{expense.name}</Text>
                    <Text style={[styles.meta, { color: savedPendingAttachments ? success : warning }]}>
                      {savedPendingAttachments
                        ? t('travel.legacyAttachmentsPending')
                        : canResolve ? t('travel.needsTransactionDate') : t('travel.legacyExpenseAuthorOnly')}
                    </Text>
                    <Text style={[styles.meta, { color: textMuted }]}>{getTripCategoryLabel(expense.category, t)}</Text>
                  </View>
                  <View style={styles.amountGroup}>
                    <Text style={styles.amount}>
                      {expense.amountMinor === undefined
                        ? t('travel.unsafeLegacyAmount')
                        : formatDkk(expense.amountMinor, locale)}
                    </Text>
                    <Text style={[styles.originalAmount, { color: textMuted }]}>{t('travel.notIncludedInSpend')}</Text>
                  </View>
                </Card>
            );
            return canResolve ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({
                  pathname: '/travel/[id]/expenses/edit/[expenseId]',
                  params: { id: id!, expenseId: expense.id },
                })}>
                {content}
              </Pressable>
            ) : content;
          }

          const projection = item.value;
          const editable = projection.expenseOwnerId === myUserId;
          const content = (
            <Card style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{projection.name}</Text>
                <Text style={[styles.meta, { color: textMuted }]}>
                  {getTripCategoryLabel(projection.category, t)} · {projection.transactionDate}
                </Text>
              </View>
              <Text style={styles.amount}>{formatDkk(projection.amount, locale)}</Text>
            </Card>
          );
          return editable
            ? <Pressable accessibilityRole="button" onPress={() => router.push(`/expenses/edit/${projection.expenseId}`)}>{content}</Pressable>
            : content;
        }}
      />

      <Button
        label={t('expenses.addButton')}
        onPress={() => router.push({ pathname: '/travel/[id]/expenses/new', params: { id: id! } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  total: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  settledLabel: { fontSize: 12, textAlign: 'center', marginBottom: 8 },
  status: { fontSize: 12, textAlign: 'center', marginBottom: 6 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  list: { gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  name: { fontWeight: '700' },
  meta: { fontSize: 13, marginTop: 2 },
  amountGroup: { maxWidth: '45%', alignItems: 'flex-end' },
  amount: { fontWeight: '700' },
  originalAmount: { fontSize: 11, marginTop: 2, textAlign: 'right' },
  empty: { textAlign: 'center', marginTop: 24 },
});

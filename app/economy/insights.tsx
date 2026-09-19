import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import TrendLineChart from '@/components/TrendLineChart';
import { sharedStyles } from '@/constants/sharedStyles';
import { budgetPeriodForInstant } from '@/core/dates/budgetPeriod';
import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import { MoneyError, ZERO_MINOR_UNITS } from '@/core/money/minorUnits';
import { usePreparedEconomyMonth } from '@/features/economy/currentPeriod';
import {
  settledSpendingChange,
  type SpendingChangeFact,
  type SpendingChangeSource,
  type SyncFreshness,
} from '@/features/economy/explainableInsights';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getExpenseTrend, getIncomeTrend, getSavingsTrend } from '@/utils/expense/economyInsights';
import { formatMonthLabel, monthKeyToDate } from '@/utils/shared/monthKey';

const MONTHS_BACK = 6;

/** APP-046: the wording for each typed fact. A new source or freshness state needs copy here. */
const SOURCE_COPY: Record<SpendingChangeSource['kind'], string> = {
  'registered-economy-records': 'economy.insights.sourceRegistered',
};
const SYNC_FRESHNESS_COPY: Record<SyncFreshness['status'], string> = {
  'not-available': 'economy.insights.syncNotAvailable',
};

export default function EconomyInsightsScreen() {
  const { t, i18n } = useTranslation();
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const locale = moneyLocaleFor(i18n.language);
  const monthLabel = (key: string) => formatMonthLabel(monthKeyToDate(key), locale);

  const expenses = useExpensesStore((s) => s.expenses);
  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const savingsHistory = useSavingsGoalsStore((s) => s.history);

  // APP-045: the trends end at the current Copenhagen budget month.
  const { monthKey } = budgetPeriodForInstant(new Date());
  // That month's recurring costs are prepared through the shared APP-045 path
  // before its expense point is shown, so opening this screen directly cannot
  // show the month without a due instance. It also means the Expenses have been
  // read from disk, which the APP-046 facts below need; preparation itself never
  // touches the completed months they compare.
  const monthPrepared = usePreparedEconomyMonth(monthKey);
  const expenseTrend = getExpenseTrend(expenses, MONTHS_BACK, locale, monthKey);
  const incomeTrend = getIncomeTrend(incomeByMonth, MONTHS_BACK, locale, monthKey);
  const savingsTrend = getSavingsTrend(savingsHistory, MONTHS_BACK, locale, monthKey);

  const currentExpense = expenseTrend[expenseTrend.length - 1]?.value ?? ZERO_MINOR_UNITS;
  const currentIncome = incomeTrend[incomeTrend.length - 1]?.value ?? ZERO_MINOR_UNITS;
  const currentSaved = savingsTrend[savingsTrend.length - 1]?.value ?? ZERO_MINOR_UNITS;

  // APP-046 (docs/app-046-explainable-insights.md): the two latest completed
  // months, never the open one. The screen only words these facts.
  let change: SpendingChangeFact | null = null;
  let cannotCalculate = false;
  if (monthPrepared) {
    try {
      change = settledSpendingChange({ currentMonthKey: monthKey, expenses });
    } catch (error) {
      // Fail closed on an unsafe difference: a fixed message, never a clamped number.
      if (!(error instanceof MoneyError)) throw error;
      cannotCalculate = true;
    }
  }

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Text style={sharedStyles.sectionLabel}>{t('economy.insights.changeTitle')}</Text>
      <Card style={sharedStyles.card}>
        {change === null ? (
          <Text style={{ color: textMuted }}>
            {cannotCalculate ? t('economy.insights.cannotCalculate') : t('economy.insights.loading')}
          </Text>
        ) : change.kind === 'no-registered-spending' ? (
          <Text style={styles.sentence}>
            {t('economy.insights.noRegisteredSpending', {
              previous: monthLabel(change.previous.monthKey),
              latest: monthLabel(change.latest.monthKey),
            })}
          </Text>
        ) : (
          <>
            <View style={styles.headline}>
              <Text accessibilityRole="header" style={styles.cardTitle}>
                {t('economy.insights.monthSpending', { month: monthLabel(change.latest.monthKey) })}
              </Text>
              <Text style={styles.amount}>{formatDkk(change.latest.settledSpending, locale)}</Text>
            </View>
            {/* Direction is always text; no colour carries it. */}
            <Text style={styles.direction}>
              {t(`economy.insights.direction.${change.direction}`, {
                amount: formatDkk(change.absoluteDelta, locale),
                month: monthLabel(change.previous.monthKey),
              })}
            </Text>
            <FactRow
              label={t('economy.insights.monthSpending', { month: monthLabel(change.previous.monthKey) })}
              value={formatDkk(change.previous.settledSpending, locale)}
            />
            {[change.latest, change.previous].map((month) => (
              <Text key={month.monthKey} style={[styles.context, { color: textMuted }]}>
                {t('economy.insights.expenseCount', { count: month.expenseCount, month: monthLabel(month.monthKey) })}
              </Text>
            ))}
          </>
        )}
      </Card>

      {change !== null && (
        <>
          <Text style={sharedStyles.sectionLabel}>{t('economy.insights.basisTitle')}</Text>
          <Card muted style={sharedStyles.card}>
            <FactRow
              label={t('economy.insights.comparisonLabel')}
              value={t('economy.insights.comparisonValue', {
                previous: monthLabel(change.previous.monthKey),
                latest: monthLabel(change.latest.monthKey),
              })}
            />
            <FactRow label={t('economy.insights.sourceLabel')} value={t(SOURCE_COPY[change.source.kind])} />
            <FactRow
              label={t('economy.insights.syncLabel')}
              value={t(SYNC_FRESHNESS_COPY[change.syncFreshness.status])}
            />
            <Text style={[styles.context, { color: textMuted }]}>
              {t('economy.insights.notes.completedMonths', { month: monthLabel(change.coverage.openMonthKey) })}
            </Text>
            <Text style={[styles.context, { color: textMuted }]}>{t('economy.insights.notes.registered')}</Text>
            <Text style={[styles.context, { color: textMuted }]}>{t('economy.insights.notes.sync')}</Text>
          </Card>
        </>
      )}

      <Text style={sharedStyles.sectionLabel}>{t('economy.expenseTrendLabel')}</Text>
      <Card>
        {monthPrepared ? (
          <>
            <TrendLineChart data={expenseTrend} />
            {/* The open month holds what is registered for it so far, not a "through today" figure. */}
            <Text style={[styles.summary, { color: textMuted }]}>
              {t('economy.insights.currentMonthExpenses', {
                amount: formatDkk(currentExpense, locale),
                month: monthLabel(monthKey),
              })}
            </Text>
          </>
        ) : (
          <Text style={{ color: textMuted }}>{t('economy.preparingMonth')}</Text>
        )}
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t('economy.incomeTrendLabel')}</Text>
      <Card>
        <TrendLineChart data={incomeTrend} />
        <Text style={[styles.summary, { color: textMuted }]}>{formatDkk(currentIncome, locale)}</Text>
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t('economy.savingsTrendLabel')}</Text>
      <Card>
        <TrendLineChart data={savingsTrend} />
        <Text style={[styles.summary, { color: textMuted }]}>{formatDkk(currentSaved, locale)}</Text>
      </Card>
    </ScrollView>
  );
}

/** Label and value form one element, so a screen reader reads them together. */
function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View accessible style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 13, marginTop: 6, textAlign: 'center', fontWeight: '700' },
  headline: { gap: 2, backgroundColor: 'transparent' },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  amount: { fontSize: 24, fontWeight: '900' },
  direction: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  sentence: { fontSize: 14, lineHeight: 20 },
  context: { fontSize: 13, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    columnGap: 12,
    backgroundColor: 'transparent',
  },
  rowLabel: { flexShrink: 1, fontSize: 14, lineHeight: 20 },
  rowValue: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});

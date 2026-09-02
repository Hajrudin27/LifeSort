import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import TrendLineChart from '@/components/TrendLineChart';
import { sharedStyles } from '@/constants/sharedStyles';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getExpenseTrend, getIncomeTrend, getSavingsTrend } from '@/utils/expense/economyInsights';

const MONTHS_BACK = 6;

export default function EconomyInsightsScreen() {
  const { t, i18n } = useTranslation();
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';

  const expenses = useExpensesStore((s) => s.expenses);
  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const savingsHistory = useSavingsGoalsStore((s) => s.history);

  const expenseTrend = getExpenseTrend(expenses, MONTHS_BACK, locale);
  const incomeTrend = getIncomeTrend(incomeByMonth, MONTHS_BACK, locale);
  const savingsTrend = getSavingsTrend(savingsHistory, MONTHS_BACK, locale);

  const currentExpense = expenseTrend[expenseTrend.length - 1]?.value ?? 0;
  const currentIncome = incomeTrend[incomeTrend.length - 1]?.value ?? 0;
  const currentSaved = savingsTrend[savingsTrend.length - 1]?.value ?? 0;

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Text style={sharedStyles.sectionLabel}>{t('economy.expenseTrendLabel')}</Text>
      <Card>
        <TrendLineChart data={expenseTrend} />
        <Text style={[styles.summary, { color: textMuted }]}>{currentExpense.toFixed(0)} kr.</Text>
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t('economy.incomeTrendLabel')}</Text>
      <Card>
        <TrendLineChart data={incomeTrend} />
        <Text style={[styles.summary, { color: textMuted }]}>{currentIncome.toFixed(0)} kr.</Text>
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t('economy.savingsTrendLabel')}</Text>
      <Card>
        <TrendLineChart data={savingsTrend} />
        <Text style={[styles.summary, { color: textMuted }]}>{currentSaved.toFixed(0)} kr.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = {
  summary: { fontSize: 13, marginTop: 6, textAlign: 'center' as const, fontWeight: '700' as const },
};
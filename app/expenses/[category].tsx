import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable, StyleSheet } from "react-native";

import EmptyState from "@/components/EmptyState";
import ProgressBar from "@/components/ProgressBar";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useBrandTints } from "@/hooks/useBrandTints";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { Expense, ExpenseCategory } from "@/types/expense";
import { getCategoryIconName } from "@/utils/expense/expenseCategoryIcon";
import { getCategoryLabel } from "@/utils/expense/expenseCategoryLabel";

export default function CategoryExpensesScreen() {
  const { t, i18n } = useTranslation();
  const { category, month } = useLocalSearchParams<{ category: ExpenseCategory; month?: string }>();
  const accentTints = useAccentTints();
  const background = useThemeColor({}, "background");
  const brand = useBrandTints();
  const surface = useThemeColor({}, "surface");
  const border = useThemeColor({}, "border");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");
  const locale = i18n.language === "da" ? "da-DK" : "en-US";

  const categoryKey = category ?? "other";
  const categoryLabel = getCategoryLabel(categoryKey, t);
  const allExpenses = useExpensesStore((s) => s.expenses);
  const categoryBudgets = useExpensesStore((s) => s.categoryBudgets);
  const budget = categoryBudgets[categoryKey];

  const expenses = allExpenses
    .filter((e) => e.category === categoryKey && (!month || e.nextPaymentDate.slice(0, 7) === month))
    .sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate));
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const recurringCount = expenses.filter((e) => e.isRecurring).length;
  const budgetProgress = budget ? total / budget : null;
  const isOverBudget = budget !== undefined && total > budget;
  const remainingBudget = budget !== undefined ? budget - total : null;

  const formatCurrency = (amount: number) =>
    `${Math.round(amount).toLocaleString(locale)} ${t("expenses.currency")}`;

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
      new Date(`${date}T00:00:00`),
    );

  const showActions = (expense: Expense) => {
    Alert.alert(expense.name, undefined, [
      { text: t("expenses.edit"), onPress: () => router.push(`/expenses/edit/${expense.id}`) },
      { text: t("expenses.cancel"), style: "cancel" },
    ]);
  };

  const renderExpense = ({ item }: { item: Expense }) => (
    <Pressable onPress={() => router.push(`/expenses/edit/${item.id}`)} onLongPress={() => showActions(item)}>
      <View style={[styles.expenseRow, { backgroundColor: surface, borderColor: border }]}>
        <View style={[styles.dateBadge, { backgroundColor: accentTints.accentSoft }]}>
          <Text style={[styles.dateText, { color: accentTints.accent }]} numberOfLines={1}>
            {formatDate(item.nextPaymentDate)}
          </Text>
        </View>
        <View style={styles.expenseTextGroup}>
          <Text style={styles.expenseName} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.expenseMeta, { color: textMuted }]} numberOfLines={1}>
            {item.isRecurring ? t("expenses.recurring") : t("expenses.oneTimePayment")}
          </Text>
        </View>
        <View style={styles.expenseAmountGroup}>
          <Text style={styles.expenseAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
            {formatCurrency(item.amount)}
          </Text>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={textMuted} />
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <Stack.Screen options={{ title: categoryLabel }} />

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        renderItem={renderExpense}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={[styles.hero, { backgroundColor: brand.inkDeep }]}>
              <View style={[styles.heroCircleLarge, { backgroundColor: accentTints.accent }]} />
              <View style={[styles.heroCircleSmall, { backgroundColor: accentTints.accentSoft }]} />
              <View style={styles.heroTopRow}>
                <View style={styles.heroIcon}>
                  <SymbolView name={getCategoryIconName(categoryKey) as any} size={23} tintColor="#FFFFFF" />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("expenses.a11y.addExpense")}
                  hitSlop={3}
                  style={styles.heroAddButton}
                  onPress={() => router.push("/expenses/new")}>
                  <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={17} tintColor="#FFFFFF" />
                </Pressable>
              </View>
              <Text style={styles.heroKicker} numberOfLines={1}>{t("expenses.categoryDetailKicker")}</Text>
              <Text style={styles.heroTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                {categoryLabel}
              </Text>
              <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                {formatCurrency(total)}
              </Text>
              <Text style={styles.heroSubtitle} numberOfLines={2}>
                {budget !== undefined
                  ? isOverBudget
                    ? t("expenses.categoryDetailOverBudget", { amount: formatCurrency(Math.abs(remainingBudget ?? 0)) })
                    : t("expenses.categoryDetailRemaining", { amount: formatCurrency(remainingBudget ?? 0) })
                  : t("expenses.categoryDetailNoBudget")}
              </Text>
              {budgetProgress !== null && <ProgressBar progress={budgetProgress} />}
            </View>

            <View style={styles.metricGrid}>
              <View style={[styles.metricCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.metricLabel, { color: textMuted }]} numberOfLines={1}>{t("expenses.itemsLabel")}</Text>
                <Text style={styles.metricValue}>{expenses.length}</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.metricLabel, { color: textMuted }]} numberOfLines={1}>{t("expenses.recurringShortLabel")}</Text>
                <Text style={styles.metricValue}>{recurringCount}</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.metricLabel, { color: textMuted }]} numberOfLines={1}>{t("expenses.budgetLabel")}</Text>
                <Text style={[styles.metricValue, isOverBudget && { color: danger }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                  {budget !== undefined ? formatCurrency(budget) : "—"}
                </Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleGroup}>
                <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t("expenses.categoryPaymentsEyebrow")}</Text>
                <Text style={styles.sectionTitle} numberOfLines={1}>{t("expenses.categoryPaymentsTitle")}</Text>
              </View>
              {month && (
                <Text style={[styles.sectionMeta, { color: textMuted }]} numberOfLines={1}>
                  {month}
                </Text>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={{ ios: "tray.fill", android: "inbox", web: "inbox" }}
            title={t("expenses.categoryEmptyTitle")}
            subtitle={t("expenses.categoryEmptySubtitle")}
            actionLabel={t("expenses.addButton")}
            onAction={() => router.push("/expenses/new")}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 42 },
  header: { gap: 12, marginBottom: 2, backgroundColor: "transparent" },
  hero: {
    borderRadius: 26,
    gap: 8,
    padding: 20,
    position: "relative",
    overflow: "hidden",
  },
  heroCircleLarge: { position: "absolute", width: 190, height: 190, borderRadius: 95, top: -70, right: -48, opacity: 0.32 },
  heroCircleSmall: { position: "absolute", width: 118, height: 118, borderRadius: 59, bottom: -48, left: -28, opacity: 0.26 },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "transparent" },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  heroAddButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  heroKicker: { color: "#F5C8D2", fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase", backgroundColor: "transparent", marginTop: 8 },
  heroTitle: { color: "#FFFFFF", fontSize: 25, lineHeight: 31, fontWeight: "900", backgroundColor: "transparent" },
  heroAmount: { color: "#FFFFFF", fontSize: 34, lineHeight: 41, fontWeight: "900", backgroundColor: "transparent" },
  heroSubtitle: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, fontWeight: "700", opacity: 0.82, backgroundColor: "transparent" },
  metricGrid: { flexDirection: "row", gap: 8, backgroundColor: "transparent" },
  metricCard: { flex: 1, minHeight: 74, borderWidth: 1, borderRadius: 18, padding: 12, justifyContent: "center", gap: 5 },
  metricLabel: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
  metricValue: { fontSize: 18, lineHeight: 23, fontWeight: "900" },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, backgroundColor: "transparent", marginTop: 4 },
  sectionTitleGroup: { flex: 1, minWidth: 0, backgroundColor: "transparent" },
  sectionEyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase" },
  sectionTitle: { fontSize: 21, lineHeight: 27, fontWeight: "900", marginTop: 2 },
  sectionMeta: { maxWidth: 90, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "right" },
  expenseRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 20,
    padding: 13,
  },
  dateBadge: { width: 58, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dateText: { fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "capitalize" },
  expenseTextGroup: { flex: 1, minWidth: 0, gap: 4, backgroundColor: "transparent" },
  expenseName: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  expenseMeta: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  expenseAmountGroup: { width: 108, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, backgroundColor: "transparent" },
  expenseAmount: { maxWidth: 88, fontSize: 15, lineHeight: 20, fontWeight: "900", textAlign: "right" },
});

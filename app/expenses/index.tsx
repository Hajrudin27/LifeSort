import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet } from "react-native";

import EmptyState from "@/components/EmptyState";
import ExpensePieChart from "@/components/ExpensePieChart";
import ProgressBar from "@/components/ProgressBar";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useBrandTints } from "@/hooks/useBrandTints";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { getCategoryIconName } from "@/utils/expense/expenseCategoryIcon";
import { getCategoryLabel } from "@/utils/expense/expenseCategoryLabel";
import { categoryTotalForMonth, totalForMonth } from "@/utils/expense/expenseStats";
import { daysUntil } from "@/utils/shared/dateDays";
import { addMonths, formatMonthLabel, getMonthKey } from "@/utils/shared/monthKey";

const SPIKE_THRESHOLD = 1.3;
const UPCOMING_WINDOW_DAYS = 7;

export default function ExpensesScreen() {
  const { t, i18n } = useTranslation();
  const accentTints = useAccentTints();
  const background = useThemeColor({}, "background");
  const brand = useBrandTints();
  const surface = useThemeColor({}, "surface");
  const border = useThemeColor({}, "border");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");
  const locale = i18n.language === "da" ? "da-DK" : "en-US";

  const [selectedMonth, setSelectedMonth] = useState(() => new Date());
  const monthKey = getMonthKey(selectedMonth);
  const rollForwardMonth = useExpensesStore((s) => s.rollForwardMonth);

  useEffect(() => {
    rollForwardMonth(monthKey);
  }, [monthKey]);

  const allExpenses = useExpensesStore((s) => s.expenses);
  const categoryBudgets = useExpensesStore((s) => s.categoryBudgets);
  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const netIncome = incomeByMonth[monthKey] ?? null;

  const monthExpenses = allExpenses.filter(
    (e) => e.nextPaymentDate.slice(0, 7) === monthKey,
  );
  const total = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const remaining = netIncome !== null ? netIncome - total : null;

  const formatCurrency = (amount: number) =>
    `${Math.round(amount).toLocaleString(locale)} kr.`;

  const usedCategories = Array.from(
    new Set(monthExpenses.map((e) => e.category)),
  ).sort(
    (a, b) =>
      categoryTotalForMonth(allExpenses, monthKey, b) -
      categoryTotalForMonth(allExpenses, monthKey, a),
  );
  const categoryTotals = usedCategories.map((category) => ({
    id: category,
    amount: monthExpenses
      .filter((e) => e.category === category)
      .reduce((sum, e) => sum + e.amount, 0),
  }));

  const prevMonthKey = getMonthKey(addMonths(selectedMonth, -1));
  const prevTotal = totalForMonth(allExpenses, prevMonthKey);
  const hasPrevData = allExpenses.some(
    (e) => e.nextPaymentDate.slice(0, 7) === prevMonthKey,
  );
  const diff = total - prevTotal;
  const diffLabel = `${diff >= 0 ? "+" : ""}${formatCurrency(diff)}`;
  const percent = prevTotal > 0 ? Math.round((diff / prevTotal) * 100) : null;

  const upcomingCount = allExpenses.filter((e) => {
    const days = daysUntil(e.nextPaymentDate);
    return days >= 0 && days <= UPCOMING_WINDOW_DAYS;
  }).length;

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("expenses.a11y.search")}
          style={[styles.roundButton, { backgroundColor: surface, borderColor: border }]}
          onPress={() => router.push("/expenses/search")}
        >
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={19} tintColor={accentTints.accent} />
        </Pressable>

        <View style={[styles.monthPill, { backgroundColor: surface, borderColor: border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.a11y.previousMonth")}
            hitSlop={4}
            style={styles.monthArrow}
            onPress={() => setSelectedMonth((d) => addMonths(d, -1))}>
            <SymbolView
              name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }}
              size={18}
              tintColor={textMuted}
            />
          </Pressable>
          <Text style={styles.monthLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {formatMonthLabel(selectedMonth, locale)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.a11y.nextMonth")}
            hitSlop={4}
            style={styles.monthArrow}
            onPress={() => setSelectedMonth((d) => addMonths(d, 1))}>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor={textMuted} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("expenses.a11y.addExpense")}
          style={[styles.roundButton, styles.primaryRoundButton, { backgroundColor: accentTints.accent }]}
          onPress={() => router.push("/expenses/new")}
        >
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={20} tintColor="#FFFFFF" />
        </Pressable>
      </View>

      <FlatList
        data={usedCategories}
        keyExtractor={(c) => c}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={[styles.hero, { backgroundColor: brand.inkDeep }]}>
              <View style={[styles.heroCircleLarge, { backgroundColor: accentTints.accent }]} />
              <View style={[styles.heroCircleSmall, { backgroundColor: accentTints.accentSoft }]} />

              <View style={styles.heroTopRow}>
                <View style={styles.heroTextGroup}>
                  <Text style={styles.heroKicker} numberOfLines={1}>{t("expenses.overviewKicker")}</Text>
                  <Text style={styles.heroTitle} numberOfLines={1}>{t("expenses.totalSpentLabel")}</Text>
                  <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                    {formatCurrency(total)}
                  </Text>
                </View>
                <View style={styles.heroIconCircle}>
                  <SymbolView name={{ ios: "creditcard.fill", android: "credit_card", web: "credit_card" }} size={23} tintColor="#FFFFFF" />
                </View>
              </View>

              <View style={styles.heroMetaRow}>
                <Pressable
                  accessibilityRole="button"
                  style={styles.heroMetaPill}
                  onPress={() => router.push({ pathname: "/expenses/income", params: { month: monthKey } })}
                >
                  <SymbolView name={{ ios: "wallet.pass.fill", android: "account_balance_wallet", web: "account_balance_wallet" }} size={13} tintColor="#FFFFFF" />
                  <Text style={styles.heroMetaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                    {remaining !== null
                      ? `${formatCurrency(remaining)} ${t("expenses.leftSuffix")}`
                      : t("expenses.addIncome")}
                  </Text>
                </Pressable>

                {hasPrevData && (
                  <View style={styles.heroMetaPill}>
                    <SymbolView
                      name={{
                        ios: diff > 0 ? "arrow.up.right" : "arrow.down.right",
                        android: diff > 0 ? "trending_up" : "trending_down",
                        web: diff > 0 ? "trending_up" : "trending_down",
                      }}
                      size={12}
                      tintColor="#FFFFFF"
                    />
                    <Text style={styles.heroMetaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                      {percent !== null
                        ? t("expenses.vsLastMonthPercent", { amount: diffLabel, percent })
                        : t("expenses.vsLastMonth", { amount: diffLabel })}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.insightGrid}>
              <Pressable
                accessibilityRole="button"
                style={[styles.insightCard, { backgroundColor: surface, borderColor: border }]}
                onPress={() => router.push({ pathname: "/expenses/income", params: { month: monthKey } })}
              >
                <View style={styles.insightTopRow}>
                  <View style={[styles.statIcon, { backgroundColor: accentTints.accentSoft }]}>
                    <SymbolView name={{ ios: "banknote.fill", android: "payments", web: "payments" }} size={15} tintColor={accentTints.accent} />
                  </View>
                  <View style={[styles.insightArrow, { backgroundColor: accentTints.accentSoft }]}>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={accentTints.accent} />
                  </View>
                </View>
                <Text style={styles.insightLabel} numberOfLines={2}>
                  {t("expenses.incomeLabel")}
                </Text>
                <Text style={styles.insightValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.74}>
                  {netIncome !== null ? formatCurrency(netIncome) : t("expenses.setIncomeShort")}
                </Text>
                <Text style={[styles.insightHint, { color: textMuted }]} numberOfLines={1}>
                  {t("expenses.incomeInsightHint")}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                style={[styles.insightCard, { backgroundColor: accentTints.accentSoft, borderColor: accentTints.accentSoft }]}
                onPress={() => router.push("/expenses/upcoming")}
              >
                <View style={styles.insightTopRow}>
                  <View style={[styles.statIcon, { backgroundColor: accentTints.accentSoft }]}>
                    <SymbolView name={{ ios: "calendar.badge.clock", android: "event", web: "event" }} size={15} tintColor={accentTints.accent} />
                    {upcomingCount > 0 && (
                      <View style={[styles.infoBadge, { backgroundColor: accentTints.accent }]}>
                        <Text style={styles.infoBadgeText}>{upcomingCount}</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.insightArrow, { backgroundColor: "rgba(255,255,255,0.42)" }]}>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={accentTints.accent} />
                  </View>
                </View>
                <Text style={styles.insightLabel} numberOfLines={2}>
                  {t("expenses.upcomingLabel")}
                </Text>
                <Text style={styles.insightValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.74}>
                  {t("expenses.upcomingHeroCount", { count: upcomingCount })}
                </Text>
                <Text style={[styles.insightHint, { color: textMuted }]} numberOfLines={1}>
                  {t("expenses.next7Days")}
                </Text>
              </Pressable>
            </View>

            {usedCategories.length === 0 ? (
              <EmptyState
                icon={{ ios: "tray.fill", android: "inbox", web: "inbox" }}
                title={t("expenses.emptyState")}
                subtitle={t("expenses.emptySubtitle")}
                actionLabel={t("expenses.addButton")}
                onAction={() => router.push("/expenses/new")}
              />
            ) : (
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleGroup}>
                  <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t("expenses.categorySectionEyebrow")}</Text>
                  <Text style={styles.sectionTitle} numberOfLines={1}>{t("expenses.categoriesLabel")}</Text>
                </View>
                <Text style={[styles.sectionMeta, { color: textMuted }]} numberOfLines={1}>
                  {usedCategories.length} {t("expenses.categoriesLabel").toLowerCase()}
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item: category }) => {
          const inCategory = monthExpenses.filter((e) => e.category === category);
          const subtotal = inCategory.reduce((sum, e) => sum + e.amount, 0);
          const prevCategoryTotal = categoryTotalForMonth(allExpenses, prevMonthKey, category);
          const isSpike = prevCategoryTotal > 0 && subtotal > prevCategoryTotal * SPIKE_THRESHOLD;

          const budget = categoryBudgets[category];
          const budgetProgress = budget ? subtotal / budget : null;
          const isOverBudget = budget !== undefined && subtotal > budget;

          return (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/expenses/[category]", params: { category, month: monthKey } })}>
              <View style={[styles.categoryCard, { backgroundColor: surface, borderColor: isSpike || isOverBudget ? danger : border }]}>
                <View style={styles.folderTopRow}>
                  <View style={[styles.iconCircle, { backgroundColor: isSpike || isOverBudget ? danger : accentTints.accentSoft }]}>
                    <SymbolView
                      name={getCategoryIconName(category) as any}
                      size={17}
                      tintColor={isSpike || isOverBudget ? "#FFFFFF" : accentTints.accent}
                    />
                  </View>
                  <View style={styles.folderText}>
                    <View style={styles.folderNameRow}>
                      <Text style={styles.folderName} numberOfLines={1}>{getCategoryLabel(category, t)}</Text>
                      {isSpike && (
                        <View style={[styles.spikeBadge, { backgroundColor: danger }]}>
                          <SymbolView name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }} size={9} tintColor="#FFFFFF" />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.categoryMeta, { color: textMuted }]} numberOfLines={1}>
                      {inCategory.length} {t("expenses.itemsLabel")} · {budget !== undefined ? t("expenses.categoryBudgetMeta", { amount: formatCurrency(subtotal), budget: formatCurrency(budget) }) : t("expenses.budgetMissing")}
                      {isSpike ? ` · ${t("expenses.categorySpike")}` : ""}
                    </Text>
                  </View>
                  <View style={styles.categoryAmountGroup}>
                    <Text style={styles.categoryAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                      {formatCurrency(subtotal)}
                    </Text>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={textMuted} />
                  </View>
                </View>
                {budgetProgress !== null && <ProgressBar progress={budgetProgress} />}
                {isOverBudget && (
                  <Text style={[styles.overBudgetText, { color: danger }]}>
                    {t("expenses.overBudget", { amount: Math.round(subtotal - budget!).toLocaleString(locale) })}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          netIncome !== null && netIncome > 0 ? (
            <View style={[styles.chartCard, { backgroundColor: surface, borderColor: border }]}>
              <View style={styles.chartHeader}>
                <View style={[styles.statIcon, { backgroundColor: accentTints.accentSoft }]}>
                  <SymbolView name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }} size={15} tintColor={accentTints.accent} />
                </View>
                <View style={styles.statText}>
                  <Text style={[styles.infoLabel, { color: textMuted }]} numberOfLines={1}>{t("expenses.overviewLabel")}</Text>
                  <Text style={styles.infoValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                    {t("expenses.availableLabel")}: {remaining !== null ? formatCurrency(remaining) : "—"}
                  </Text>
                </View>
              </View>
              <ExpensePieChart netIncome={netIncome} categoryTotals={categoryTotals} containerStyle={{ marginTop: 14, alignSelf: "center" }} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  roundButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryRoundButton: {
    borderWidth: 0,
    shadowColor: "#3B2C24",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 4,
  },
  monthPill: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  monthLabel: { flex: 1, fontSize: 15, fontWeight: "800", textAlign: "center", textTransform: "capitalize" },
  list: { gap: 12, paddingBottom: 28 },
  hero: {
    padding: 20,
    gap: 18,
    position: "relative",
    borderRadius: 26,
    overflow: "hidden",
  },
  heroCircleLarge: { position: "absolute", width: 190, height: 190, borderRadius: 95, top: -70, right: -46, opacity: 0.32 },
  heroCircleSmall: { position: "absolute", width: 118, height: 118, borderRadius: 59, bottom: -46, left: -22, opacity: 0.28 },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 16, backgroundColor: "transparent" },
  heroIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextGroup: { flex: 1, minWidth: 0, backgroundColor: "transparent" },
  heroKicker: { color: "#F5C8D2", fontSize: 11, lineHeight: 15, fontWeight: "800", textTransform: "uppercase", backgroundColor: "transparent" },
  heroTitle: { color: "#FFFFFF", fontSize: 16, lineHeight: 21, fontWeight: "700", opacity: 0.78, backgroundColor: "transparent", marginTop: 8 },
  heroAmount: { fontSize: 36, lineHeight: 43, fontWeight: "900", color: "#FFFFFF", backgroundColor: "transparent", marginTop: 2 },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "transparent" },
  heroMetaPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 18,
    paddingVertical: 9,
    paddingHorizontal: 11,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  heroMetaText: { flex: 1, fontSize: 11, lineHeight: 15, color: "#FFFFFF", fontWeight: "800", backgroundColor: "transparent" },
  insightGrid: { flexDirection: "row", gap: 10, backgroundColor: "transparent" },
  insightCard: {
    flex: 1,
    minHeight: 142,
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    justifyContent: "space-between",
  },
  insightTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "transparent",
  },
  insightArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  insightLabel: { minHeight: 40, fontSize: 15, lineHeight: 20, fontWeight: "900", backgroundColor: "transparent" },
  insightValue: { fontSize: 20, lineHeight: 26, fontWeight: "900", backgroundColor: "transparent" },
  insightHint: { fontSize: 11, lineHeight: 15, fontWeight: "800", backgroundColor: "transparent" },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  statText: { flex: 1, minWidth: 0, gap: 5, backgroundColor: "transparent" },
  infoLabel: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  infoValue: { fontSize: 14, lineHeight: 20, fontWeight: "900" },
  statValue: { fontSize: 20, lineHeight: 26, fontWeight: "900" },
  infoBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  infoBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 8,
    marginBottom: -2,
    backgroundColor: "transparent",
  },
  sectionTitleGroup: { flex: 1, minWidth: 0, backgroundColor: "transparent" },
  sectionEyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase" },
  sectionTitle: { fontSize: 22, lineHeight: 28, fontWeight: "900", marginTop: 2 },
  sectionMeta: { maxWidth: 112, fontSize: 12, lineHeight: 16, fontWeight: "700", marginBottom: 4, textAlign: "right" },
  categoryCard: { gap: 11, borderWidth: 1, borderRadius: 20, padding: 14 },
  folderTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  folderText: { flex: 1, minWidth: 0, gap: 3 },
  folderNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  folderName: { flexShrink: 1, fontWeight: "800", fontSize: 16, lineHeight: 21 },
  categoryMeta: { fontSize: 12, lineHeight: 17 },
  spikeBadge: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  categoryAmountGroup: { width: 96, alignItems: "flex-end", gap: 5, backgroundColor: "transparent" },
  categoryAmount: { maxWidth: 96, fontSize: 15, lineHeight: 20, fontWeight: "900", textAlign: "right" },
  overBudgetText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  chartCard: { borderWidth: 1, borderRadius: 22, padding: 16, marginTop: 4 },
  chartHeader: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "transparent" },
});

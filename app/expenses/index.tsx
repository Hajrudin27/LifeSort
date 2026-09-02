import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet } from "react-native";

import ExpensePieChart from "@/components/ExpensePieChart";
import ProgressBar from "@/components/ProgressBar";
import { Text, useThemeColor, View } from "@/components/Themed";
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
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");
  const success = useThemeColor({}, "success");
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

  const usedCategories = Array.from(
    new Set(monthExpenses.map((e) => e.category)),
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
  const diffLabel = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} kr.`;
  const percent = prevTotal > 0 ? Math.round((diff / prevTotal) * 100) : null;

  const upcomingCount = allExpenses.filter((e) => {
    const days = daysUntil(e.nextPaymentDate);
    return days >= 0 && days <= UPCOMING_WINDOW_DAYS;
  }).length;

  return (
    <View style={styles.container}>
      <View style={styles.monthSwitcher}>
        <Pressable onPress={() => setSelectedMonth((d) => addMonths(d, -1))}>
          <SymbolView
            name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }}
            size={20}
            tintColor={textMuted}
          />
        </Pressable>
        <Text style={styles.monthLabel}>{formatMonthLabel(selectedMonth, locale)}</Text>
        <View style={styles.monthRightGroup}>
          <Pressable onPress={() => router.push("/expenses/search")}>
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={textMuted} />
          </Pressable>
          <Pressable onPress={() => setSelectedMonth((d) => addMonths(d, 1))}>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={20} tintColor={textMuted} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={usedCategories}
        keyExtractor={(c) => c}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={[styles.hero, { backgroundColor: accentTints.accent, overflow: "hidden" }]}>
              <View style={[styles.heroCircleLarge, { backgroundColor: "#FFFFFF", opacity: 0.08 }]} />
              <View style={[styles.heroCircleSmall, { backgroundColor: "#FFFFFF", opacity: 0.1 }]} />

              <View style={styles.heroTopRow}>
                <View style={styles.heroIconCircle}>
                  <SymbolView name={{ ios: "banknote.fill", android: "payments", web: "payments" }} size={22} tintColor="#FFFFFF" />
                </View>
                <View style={styles.heroTextGroup}>
                  <Text style={styles.heroKicker}>{t("expenses.totalSpentLabel") ?? t("expenses.screenTitle")}</Text>
                  <Text style={styles.heroAmount}>{total.toFixed(0)} kr.</Text>
                </View>
              </View>

              {hasPrevData && (
                <View
                  style={[
                    styles.heroComparisonPill,
                    { backgroundColor: diff > 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.18)" },
                  ]}
                >
                  <SymbolView
                    name={{
                      ios: diff > 0 ? "arrow.up.right" : "arrow.down.right",
                      android: diff > 0 ? "trending_up" : "trending_down",
                      web: diff > 0 ? "trending_up" : "trending_down",
                    }}
                    size={12}
                    tintColor="#FFFFFF"
                  />
                  <Text style={styles.heroComparisonText}>
                    {percent !== null
                      ? t("expenses.vsLastMonthPercent", { amount: diffLabel, percent })
                      : t("expenses.vsLastMonth", { amount: diffLabel })}
                  </Text>
                </View>
              )}
            </View>

            {/* Info-strip: indkomst + kommende betalinger side om side, rolige, ens højde */}
            <View style={styles.infoStrip}>
              <Pressable style={styles.infoStripHalf} onPress={() => router.push({ pathname: "/expenses/income", params: { month: monthKey } })}>
                <View style={[styles.infoCard, { backgroundColor: accentTints.accentSoft }]}>
                  <SymbolView name={{ ios: "wallet.pass.fill", android: "account_balance_wallet", web: "account_balance_wallet" }} size={16} tintColor={accentTints.accent} />
                  <Text style={[styles.infoLabel, { color: textMuted }]}>{t("expenses.incomeLabel")}</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {netIncome !== null ? `${netIncome.toFixed(0)} kr.` : "—"}
                  </Text>
                  {netIncome !== null && remaining !== null && (
                    <Text style={[styles.infoSubtext, { color: remaining < 0 ? danger : success }]}>
                      {remaining.toFixed(0)} kr. {t("expenses.leftSuffix") ?? ""}
                    </Text>
                  )}
                </View>
              </Pressable>

              <Pressable style={styles.infoStripHalf} onPress={() => router.push("/expenses/upcoming")}>
                <View style={[styles.infoCard, { backgroundColor: accentTints.accentSoft }]}>
                  <View style={styles.infoTopRow}>
                    <SymbolView name={{ ios: "calendar.badge.clock", android: "event", web: "event" }} size={16} tintColor={accentTints.accent} />
                    {upcomingCount > 0 && (
                      <View style={[styles.infoBadge, { backgroundColor: accentTints.accent }]}>
                        <Text style={styles.infoBadgeText}>{upcomingCount}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.infoLabel, { color: textMuted }]}>{t("expenses.upcomingLabel")}</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>{t("expenses.next7Days") ?? ""}</Text>
                </View>
              </Pressable>
            </View>

            {usedCategories.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={{ ios: "tray.fill", android: "inbox", web: "inbox" }} size={28} tintColor={accentTints.accent} />
                <Text style={{ color: textMuted, marginTop: 8 }}>{t("expenses.emptyState")}</Text>
              </View>
            ) : (
              <Text style={styles.sectionLabel}>{t("expenses.categoriesLabel") ?? t("expenses.screenTitle")}</Text>
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
            <Pressable onPress={() => router.push({ pathname: "/expenses/[category]", params: { category, month: monthKey } })}>
              <View style={[styles.folderCard, { borderColor: isSpike || isOverBudget ? danger : accentTints.accentSoft }]}>
                <View style={styles.folderTopRow}>
                  <View style={styles.iconWrap}>
                    <View style={[styles.iconGlow, { backgroundColor: isSpike || isOverBudget ? danger + "22" : accentTints.accentSoft }]} />
                    <View style={[styles.iconCircle, { backgroundColor: isSpike || isOverBudget ? danger : accentTints.accent }]}>
                      <SymbolView name={getCategoryIconName(category) as any} size={17} tintColor="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.folderText}>
                    <View style={styles.folderNameRow}>
                      <Text style={styles.folderName}>{getCategoryLabel(category, t)}</Text>
                      {isSpike && (
                        <View style={[styles.spikeBadge, { backgroundColor: danger }]}>
                          <SymbolView name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }} size={9} tintColor="#FFFFFF" />
                        </View>
                      )}
                    </View>
                    <Text style={{ color: textMuted, fontSize: 12 }}>
                      {inCategory.length} {t("expenses.itemsLabel") ?? ""} · {subtotal.toFixed(0)} kr.
                      {budget !== undefined ? ` / ${budget.toFixed(0)} kr.` : ""}
                      {isSpike ? ` · ${t("expenses.categorySpike")}` : ""}
                    </Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={textMuted} />
                </View>
                {budgetProgress !== null && <ProgressBar progress={budgetProgress} />}
                {isOverBudget && (
                  <Text style={[styles.overBudgetText, { color: danger }]}>
                    {t("expenses.overBudget", { amount: (subtotal - budget!).toFixed(0) })}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          netIncome !== null && netIncome > 0 ? (
            <View style={[styles.chartCard, { borderColor: accentTints.accentSoft }]}>
              <View style={[styles.kicker, { backgroundColor: accentTints.accentSoft }]}>
                <Text style={[styles.kickerText, { color: accentTints.accent }]}>{t("expenses.overviewLabel") ?? t("expenses.screenTitle")}</Text>
              </View>
              <ExpensePieChart netIncome={netIncome} categoryTotals={categoryTotals} containerStyle={{ marginTop: 14, alignSelf: "center" }} />
            </View>
          ) : null
        }
      />

      <Pressable style={[styles.addButton, { backgroundColor: accentTints.accent }]} onPress={() => router.push("/expenses/new")}>
        <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={18} tintColor="#FFFFFF" />
        <Text style={styles.addButtonText}>{t("expenses.addButton")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 14 },
  monthSwitcher: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  monthLabel: { fontSize: 16, fontWeight: "700", textTransform: "capitalize" },
  monthRightGroup: { flexDirection: "row", alignItems: "center", gap: 14 },
  list: { gap: 12, paddingBottom: 100 },
  hero: { padding: 22, gap: 4, position: "relative", borderRadius: 22 },
  heroCircleLarge: { position: "absolute", width: 170, height: 170, borderRadius: 85, top: -55, right: -45 },
  heroCircleSmall: { position: "absolute", width: 85, height: 85, borderRadius: 42, bottom: -28, left: -18 },
  heroTopRow: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: "transparent" },
  heroIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextGroup: { backgroundColor: "transparent" },
  heroKicker: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.6, backgroundColor: "transparent" },
  heroAmount: { fontSize: 30, fontWeight: "800", color: "#FFFFFF", backgroundColor: "transparent", marginTop: 3 },
  heroComparisonPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 11,
    marginTop: 16,
  },
  heroComparisonText: { fontSize: 12, color: "#FFFFFF", fontWeight: "700", backgroundColor: "transparent" },
  infoStrip: { flexDirection: "row", gap: 10 },
  infoStripHalf: { flex: 1 },
  infoCard: { borderRadius: 18, padding: 14, gap: 4, minHeight: 92 },
  infoTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "transparent" },
  infoLabel: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  infoValue: { fontSize: 16, fontWeight: "800" },
  infoSubtext: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  infoBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  infoBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  sectionLabel: { opacity: 0.6, fontSize: 13, fontWeight: "600", marginTop: 4, marginBottom: -2 },
  emptyCard: { alignItems: "center", borderRadius: 20, padding: 36, marginTop: 4 },
  folderCard: { gap: 10, borderWidth: 1.5, borderRadius: 20, padding: 16 },
  folderTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  iconGlow: { position: "absolute", width: 42, height: 42, borderRadius: 21 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  folderText: { flex: 1, gap: 3 },
  folderNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  folderName: { fontWeight: "800", fontSize: 16 },
  spikeBadge: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  overBudgetText: { fontSize: 11, fontWeight: "700" },
  chartCard: { borderWidth: 1.5, borderRadius: 22, padding: 18, marginTop: 4, alignItems: "center" },
  kicker: { alignSelf: "flex-start", borderRadius: 20, paddingVertical: 6, paddingHorizontal: 13 },
  kickerText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  addButton: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: "#3B2C24",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  addButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});
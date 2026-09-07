import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native";

import Card from "@/components/Card";
import ExpensePieChart from "@/components/ExpensePieChart";
import MetricCard from "@/components/MetricCard";
import QuickActionCard from "@/components/QuickActionCard";
import RingProgress from "@/components/RingProgress";
import Screen from "@/components/Screen";
import SectionHeader from "@/components/SectionHeader";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useBrandTints } from "@/hooks/useBrandTints";
import { useModuleTints } from "@/hooks/useModuleTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useFoodStore } from "@/store/useFoodStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { useTripsStore } from "@/store/useTripsStore";
import { useWarrantiesStore } from "@/store/useWarrantiesStore";
import { getISOWeekKey, getWeeksInMonth } from "@/utils/food/foodWeek";
import { daysUntil } from "@/utils/shared/dateDays";
import { getMonthKey } from "@/utils/shared/monthKey";

export default function EconomyScreen() {
  const { t, i18n } = useTranslation();
  const moduleTints = useModuleTints();
  const borderColor = useThemeColor({}, "border");
  const backgroundColor = useThemeColor({}, "background");
  const brand = useBrandTints();
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
  const textMuted = useThemeColor({}, "textMuted");
  const WARRANTY_ALERT_COLOR = useThemeColor({}, "warning");

  const allExpenses = useExpensesStore((s) => s.expenses);
  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const netIncome = incomeByMonth[getMonthKey(new Date())] ?? null;
  const [chartSize, setChartSize] = useState(0);

  const currentMonthKey = getMonthKey(new Date());
  const monthExpenses = allExpenses.filter(
    (e) => e.nextPaymentDate.slice(0, 7) === currentMonthKey,
  );

  const usedCategories = Array.from(
    new Set(monthExpenses.map((e) => e.category)),
  );
  const categoryTotals = usedCategories.map((category) => ({
    id: category,
    amount: monthExpenses
      .filter((e) => e.category === category)
      .reduce((sum, e) => sum + e.amount, 0),
  }));
  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const monthBalance = netIncome !== null ? netIncome - monthTotal : null;

  const warranties = useWarrantiesStore((s) => s.warranties);
  const expiringSoon = warranties.filter((w) => {
    const days = daysUntil(w.expiryDate);
    return days >= 0 && days <= 30;
  });
  const expiringSoonCount = expiringSoon.length;
  const [showExpiringModal, setShowExpiringModal] = useState(false);

  const goals = useSavingsGoalsStore((s) => s.goals);
  const totalSaved = goals.reduce((sum, g) => sum + g.savedAmount, 0);
  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const savingsProgress = totalTarget > 0 ? totalSaved / totalTarget : 0;
  const [showSavingsModal, setShowSavingsModal] = useState(false);

  const goToWarranty = (id: string) => {
    setShowExpiringModal(false);
    router.push(`/warranties/${id}`);
  };

  const goToGoal = (id: string) => {
    setShowSavingsModal(false);
    router.push(`/savings/${id}`);
  };

  const foodMonthlyBudgetByMonth = useFoodStore((s) => s.monthlyBudgetByMonth);
  const foodPurchases = useFoodStore((s) => s.purchases);
  const foodMonthKey = getMonthKey(new Date());
  const foodWeekKey = getISOWeekKey(new Date());
  const foodMonthlyBudget = foodMonthlyBudgetByMonth[foodMonthKey] ?? null;
  const foodWeeklyBudget =
    foodMonthlyBudget !== null
      ? foodMonthlyBudget / getWeeksInMonth(foodMonthKey).length
      : null;
  const foodSpentThisWeek = foodPurchases
    .filter((p) => getISOWeekKey(new Date(p.date)) === foodWeekKey)
    .reduce((sum, p) => sum + p.amount, 0);
  const foodProgress =
    foodWeeklyBudget !== null && foodWeeklyBudget > 0
      ? foodSpentThisWeek / foodWeeklyBudget
      : 0;

  const trips = useTripsStore((s) => s.trips);
  const upcomingTrip = [...trips]
    .filter((tr) => daysUntil(tr.startDate) >= 0)
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    )[0];
  const daysToTrip = upcomingTrip ? daysUntil(upcomingTrip.startDate) : null;
  const locale = i18n.language === "da" ? "da-DK" : "en-US";
  const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: 0,
  });
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });

  const modules = [
    {
      key: "expenses",
      title: t("economy.expenses"),
      subtitle: t("economy.expensesSubtitle", {
        amount: currency.format(monthTotal),
      }),
      icon: { ios: "creditcard.fill", android: "credit_card", web: "credit_card" },
      route: "/expenses" as const,
      tone: brand.glowPrimary,
      visual: "pie",
    },
    {
      key: "savings",
      title: t("economy.savings"),
      subtitle: t("economy.savingsSubtitle", {
        progress: percent.format(savingsProgress),
      }),
      icon: { ios: "target", android: "track_changes", web: "track_changes" },
      route: "/savings" as const,
      tone: brand.glowSecondary,
      visual: "savings",
    },
    {
      key: "warranties",
      title: t("economy.warranties"),
      subtitle: t("economy.warrantiesSubtitle", {
        count: expiringSoonCount,
      }),
      icon: {
        ios: expiringSoonCount > 0 ? "exclamationmark.shield.fill" : "checkmark.shield.fill",
        android: expiringSoonCount > 0 ? "warning" : "verified_user",
        web: expiringSoonCount > 0 ? "warning" : "verified_user",
      },
      route: "/warranties" as const,
      tone: WARRANTY_ALERT_COLOR,
      visual: "warranties",
    },
    {
      key: "food",
      title: t("economy.food"),
      subtitle:
        foodWeeklyBudget !== null
          ? t("economy.foodSubtitle", {
              amount: currency.format(foodSpentThisWeek),
              budget: currency.format(foodWeeklyBudget),
            })
          : t("economy.foodMissingBudget"),
      icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
      route: "/food" as const,
      tone: "#16A34A",
      visual: "food",
    },
    {
      key: "travel",
      title: t("economy.travel"),
      subtitle:
        daysToTrip !== null
          ? t("economy.travelSubtitle", { days: daysToTrip })
          : t("economy.travelEmpty"),
      icon: { ios: "airplane", android: "flight", web: "flight" },
      route: "/travel" as const,
      tone: "#2563EB",
      visual: "travel",
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor }]}>
      <Screen contentContainerStyle={styles.content}>
        <Card style={[styles.hero, { backgroundColor: brand.ink }]}>
          <View style={[styles.heroGlow, styles.heroGlowRose, { backgroundColor: brand.glowPrimary }]} />
          <View style={[styles.heroGlow, styles.heroGlowAmber, { backgroundColor: brand.glowSecondary }]} />
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}>
              <SymbolView
                name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }}
                tintColor="#FFFFFF"
                size={18}
              />
            </View>
            <Pressable
              style={styles.insightsButton}
              onPress={() => router.push("/economy/insights")}
            >
              <Text style={styles.insightsButtonText}>{t("economy.insightsTitle")}</Text>
              <SymbolView
                name={{ ios: "arrow.up.right", android: "north_east", web: "north_east" }}
                tintColor="#FFFFFF"
                size={13}
              />
            </Pressable>
          </View>
          <Text style={styles.heroTitle}>{t("economy.title")}</Text>
          <Text style={styles.heroSubtitle}>{t("economy.heroSubtitle")}</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t("economy.monthSpendLabel")}</Text>
              <Text style={styles.heroStatValue}>{currency.format(monthTotal)}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t("economy.balanceLabel")}</Text>
              <Text style={styles.heroStatValue}>
                {monthBalance !== null ? currency.format(monthBalance) : t("economy.noIncome")}
              </Text>
            </View>
          </View>
        </Card>

        <View style={styles.metricGrid}>
          <MetricCard
            icon={{ ios: "banknote.fill", android: "payments", web: "payments" }}
            label={t("economy.incomeLabel")}
            value={netIncome !== null ? currency.format(netIncome) : t("economy.noIncome")}
            helper={t("economy.incomeHelper")}
            tone="#16A34A"
            onPress={() => router.push("/expenses/income")}
            style={styles.metricItem}
          />
          <MetricCard
            icon={{ ios: "target", android: "track_changes", web: "track_changes" }}
            label={t("economy.savingsProgressLabel")}
            value={goals.length > 0 ? percent.format(savingsProgress) : "0%"}
            helper={t("economy.savingsProgressHelper", { count: goals.length })}
            tone={brand.glowSecondary}
            onPress={() => goals.length > 0 ? setShowSavingsModal(true) : router.push("/savings/new")}
            style={styles.metricItem}
          />
        </View>

        <SectionHeader
          eyebrow={t("economy.dashboardEyebrow")}
          title={t("economy.modulesTitle")}
          subtitle={t("economy.modulesSubtitle")}
        />

        <View style={styles.moduleList}>
          {modules.map((module) => (
            <Pressable
              key={module.key}
              onPress={() => router.push(module.route)}
            >
              <Card style={[styles.moduleCard, { borderColor: `${module.tone}33` }]}>
                <View style={[styles.moduleAccent, { backgroundColor: moduleTints[module.key as keyof typeof moduleTints] ?? surfaceMuted }]} />
                <View style={[styles.moduleIcon, { backgroundColor: `${module.tone}18` }]}>
                  <SymbolView name={module.icon as any} tintColor={module.tone} size={19} />
                </View>
                <View style={styles.moduleText}>
                  <Text style={styles.moduleTitle}>{module.title}</Text>
                  <Text style={[styles.moduleSubtitle, { color: textMuted }]} numberOfLines={2}>
                    {module.subtitle}
                  </Text>
                </View>
                <View
                  style={[styles.modulePreview, { backgroundColor: surfaceMuted, borderColor }]}
                  onLayout={module.visual === "pie" ? (e) => setChartSize(e.nativeEvent.layout.width) : undefined}
                >
                  {module.visual === "pie" && chartSize > 0 && netIncome !== null && netIncome > 0 ? (
                    <ExpensePieChart
                      netIncome={netIncome}
                      categoryTotals={categoryTotals}
                      size={Math.min(chartSize, 72)}
                      interactive={false}
                    />
                  ) : module.visual === "savings" && goals.length > 0 ? (
                    <RingProgress progress={savingsProgress} size={62} strokeWidth={6} />
                  ) : module.visual === "food" && foodWeeklyBudget !== null ? (
                    <RingProgress progress={foodProgress} size={62} strokeWidth={6} showLabel={false} />
                  ) : module.visual === "warranties" && expiringSoonCount > 0 ? (
                    <Text style={[styles.previewCount, { color: WARRANTY_ALERT_COLOR }]}>{expiringSoonCount}</Text>
                  ) : module.visual === "travel" && daysToTrip !== null ? (
                    <Text style={styles.previewCount}>{daysToTrip}</Text>
                  ) : (
                    <SymbolView
                      name={module.icon as any}
                      tintColor={borderColor}
                      size={26}
                    />
                  )}
                </View>
              </Card>
            </Pressable>
          ))}
        </View>

        <SectionHeader
          eyebrow={t("economy.shortcutEyebrow")}
          title={t("economy.quickTitle")}
        />
        <View style={styles.quickGrid}>
          <QuickActionCard
            icon={{ ios: "plus.circle.fill", android: "add_circle", web: "add_circle" }}
            title={t("economy.newExpenseTitle")}
            subtitle={t("economy.newExpenseSubtitle")}
            tone={brand.glowPrimary}
            onPress={() => router.push("/expenses/new")}
            style={styles.quickItem}
          />
          <QuickActionCard
            icon={{ ios: "calendar.badge.clock", android: "event", web: "event" }}
            title={t("economy.upcomingTitle")}
            subtitle={t("economy.upcomingSubtitle")}
            tone="#2563EB"
            onPress={() => router.push("/expenses/upcoming")}
            style={styles.quickItem}
          />
        </View>
      </Screen>

      <Modal
        visible={showExpiringModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowExpiringModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowExpiringModal(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>
              {t("warranties.expiringSoonTitle")}
            </Text>

            <FlatList
              data={expiringSoon}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const days = daysUntil(item.expiryDate);
                return (
                  <Pressable
                    style={[styles.modalRow, { borderColor }]}
                    onPress={() => goToWarranty(item.id)}
                  >
                    <Text style={styles.modalRowName}>{item.name}</Text>
                    <Text style={styles.modalRowDays}>
                      {t("warranties.expiresIn", { days })}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showSavingsModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSavingsModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowSavingsModal(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>{t("savings.screenTitle")}</Text>

            <FlatList
              data={goals}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.modalEmpty}>{t("savings.noGoalsYet")}</Text>
              }
              renderItem={({ item }) => {
                const progress =
                  item.targetAmount > 0
                    ? item.savedAmount / item.targetAmount
                    : 0;
                return (
                  <Pressable
                    style={[styles.modalRow, styles.goalRow, { borderColor }]}
                    onPress={() => goToGoal(item.id)}
                  >
                    <RingProgress
                      progress={progress}
                      size={40}
                      strokeWidth={5}
                      showLabel={false}
                    />
                    <View style={styles.goalRowText}>
                      <Text style={styles.modalRowName}>{item.name}</Text>
                      <Text style={styles.modalRowDays}>
                        {item.savedAmount.toFixed(2)} {t("savings.of")}{" "}
                        {item.targetAmount.toFixed(2)} kr.
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingBottom: 72,
  },
  hero: {
    borderColor: "rgba(255,255,255,0.08)",
    gap: 12,
    overflow: "hidden",
    padding: 20,
  },
  heroGlow: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    opacity: 0.2,
  },
  heroGlowRose: {
    right: -48,
    top: -54,
  },
  heroGlowAmber: {
    bottom: -70,
    left: -56,
  },
  heroTopRow: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
    borderRadius: 16,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  insightsButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  insightsButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 29,
    fontWeight: "900",
  },
  heroSubtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 18,
  },
  heroStats: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 18,
    flexDirection: "row",
    marginTop: 4,
    padding: 14,
  },
  heroStat: {
    backgroundColor: "transparent",
    flex: 1,
    gap: 3,
  },
  heroStatLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  heroStatValue: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  heroDivider: {
    backgroundColor: "rgba(255,255,255,0.16)",
    marginHorizontal: 14,
    width: 1,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 12,
  },
  metricItem: {
    flex: 1,
  },
  moduleList: {
    gap: 10,
  },
  moduleCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 104,
    overflow: "hidden",
  },
  moduleAccent: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: 5,
  },
  moduleIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  moduleText: {
    backgroundColor: "transparent",
    flex: 1,
    gap: 3,
  },
  moduleTitle: {
    fontSize: 16,
    fontWeight: "900",
  },
  moduleSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  modulePreview: {
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    overflow: "hidden",
    width: 72,
  },
  previewCount: {
    fontSize: 20,
    fontWeight: "900",
  },
  quickGrid: {
    gap: 10,
  },
  quickItem: {
    width: "100%",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    borderTopWidth: 1,
    borderRadius: 16,
    padding: 16,
    paddingBottom: 32,
    maxHeight: "60%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  modalRowName: { fontWeight: "600" },
  modalRowDays: { opacity: 0.6, fontSize: 13, marginTop: 2 },
  modalEmpty: { textAlign: "center", opacity: 0.5, marginTop: 24 },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  goalRowText: { flex: 1 },
});

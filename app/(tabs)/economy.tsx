import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Modal,
  Pressable,
  View as RNView,
  StyleSheet,
} from "react-native";

import EconomyModuleCard from "@/components/EconomyModuleCard";
import ExpensePieChart from "@/components/ExpensePieChart";
import RingProgress from "@/components/RingProgress";
import { Text, useThemeColor, View } from "@/components/Themed";
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
  const { t } = useTranslation();
  const moduleTints = useModuleTints();
  const borderColor = useThemeColor({}, "border");
  const backgroundColor = useThemeColor({}, "background");
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
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

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {}
        <View style={styles.row}>
          <EconomyModuleCard
            label={t("economy.warranties")}
            tintColor={moduleTints.warranties}
            onPress={() => router.push("/warranties")}
          />
          <RNView style={styles.emptyCell} />
          <Pressable
            style={[
              styles.diagramPlaceholder,
              {
                backgroundColor: surfaceMuted,
                borderColor:
                  expiringSoonCount > 0 ? WARRANTY_ALERT_COLOR : borderColor,
                  borderWidth: expiringSoonCount  > 0 ? 2 : 1,
              },
            ]}
            onPress={() => expiringSoonCount > 0 && setShowExpiringModal(true)}
          >
            <SymbolView
              name={{
                ios:
                  expiringSoonCount > 0
                    ? "exclamationmark.triangle.fill"
                    : "shield",
                android: expiringSoonCount > 0 ? "warning" : "shield",
                web: expiringSoonCount > 0 ? "warning" : "shield",
              }}
              tintColor={
                expiringSoonCount > 0 ? WARRANTY_ALERT_COLOR : borderColor
              }
              size={50}
            />

            {expiringSoonCount > 0 && (
              <View style={[styles.badge, { backgroundColor: WARRANTY_ALERT_COLOR }]}>
                <Text style={styles.badgeText}>{expiringSoonCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {}
        <View style={styles.row}>
          <EconomyModuleCard
            label={t("economy.savings")}
            tintColor={moduleTints.savings}
            onPress={() => router.push("/savings")}
          />
          <RNView style={styles.emptyCell} />
          <Pressable
            style={[styles.diagramPlaceholder, { backgroundColor: surfaceMuted }]}
            onPress={() => goals.length > 0 && setShowSavingsModal(true)}
          >
            {goals.length > 0 ? (
              <RingProgress
                progress={savingsProgress}
                size={70}
                strokeWidth={7}
              />
            ) : (
              <RNView
                style={[
                  StyleSheet.absoluteFill,
                  styles.emptyRing,
                  { borderColor },
                ]}
              />
            )}
          </Pressable>
        </View>

        {}
        <View style={styles.row}>
          <EconomyModuleCard
            label={t("economy.expenses")}
            tintColor={moduleTints.expenses}
            onPress={() => router.push("/expenses")}
          />
          <RNView style={styles.emptyCell} />
          <View
            style={[styles.diagramPlaceholder, { backgroundColor: surfaceMuted }]}
            onLayout={(e) => setChartSize(e.nativeEvent.layout.width)}
          >
            {chartSize > 0 && netIncome !== null && netIncome > 0 && (
              <ExpensePieChart
                netIncome={netIncome}
                categoryTotals={categoryTotals}
                size={chartSize}
                interactive={true}
              />
            )}
          </View>
        </View>

        {}
        <View style={styles.row}>
          <EconomyModuleCard
            label={t("economy.travel")}
            tintColor={moduleTints.travel}
            onPress={() => router.push("/travel")}
          />
          <RNView style={styles.emptyCell} />
          <View style={[styles.diagramPlaceholder, { backgroundColor: surfaceMuted, borderColor }]}>
            {upcomingTrip && (
              <Text style={styles.warrantyCount}>
                {t("travel.daysUntil", {
                  days: daysUntil(upcomingTrip.startDate),
                })}
              </Text>
            )}
          </View>
        </View>

        {}
        <View style={styles.row}>
          <EconomyModuleCard
            label={t("economy.food")}
            tintColor={moduleTints.food}
            onPress={() => router.push("/food")}
          />
          <RNView style={styles.emptyCell} />
          <View style={[styles.diagramPlaceholder, { backgroundColor: surfaceMuted }]}>
            {foodWeeklyBudget !== null ? (
              <RingProgress
                progress={foodProgress}
                size={70}
                strokeWidth={7}
                showLabel={false}
              />
            ) : (
              <RNView
                style={[
                  StyleSheet.absoluteFill,
                  styles.emptyRing,
                  { borderColor },
                ]}
              />
            )}
          </View>
        </View>
      </View>

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
  container: {
    flex: 1,
    paddingTop: 1,
    paddingHorizontal: 1,
  },
  title: {
    fontSize: 2,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 24,
  },
  grid: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    flex: 1,
  },
  emptyCell: {
    flex: 1,
    margin: 2,
  },
  diagramPlaceholder: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    margin: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyRing: {
    borderRadius: 999,
    borderWidth: 1,
    margin: 5,
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  warrantyCount: {
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 4,
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
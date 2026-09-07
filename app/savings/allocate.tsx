import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { getMonthKey } from "@/utils/shared/monthKey";

export default function AllocateSavingsScreen() {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");

  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const currentMonthKey = getMonthKey(new Date());
  const netIncome = incomeByMonth[currentMonthKey] ?? 0;
  const expenses = useExpensesStore((s) => s.expenses);
  const goals = useSavingsGoalsStore((s) => s.goals);
  const extraSavings = useSavingsGoalsStore((s) => s.extraSavings);
  const distributeContributions = useSavingsGoalsStore(
    (s) => s.distributeContributions,
  );

  const totalExpenses = expenses
    .filter((e) => e.nextPaymentDate.slice(0, 7) === currentMonthKey)
    .reduce((sum, e) => sum + e.amount, 0);
  const totalSaved = goals.reduce((sum, g) => sum + g.savedAmount, 0);
  const available = netIncome - totalExpenses - totalSaved + extraSavings;

  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const allocatedTotal = Object.values(amounts).reduce(
    (sum, v) => sum + (parseFloat(v) || 0),
    0,
  );
  const remaining = available - allocatedTotal;
  const canConfirm = allocatedTotal > 0 && remaining >= 0;

  const distributeEqually = () => {
    if (goals.length === 0 || available <= 0) return;
    const perGoal = Math.floor((available / goals.length) * 100) / 100;
    const next: Record<string, string> = {};
    goals.forEach((g) => {
      next[g.id] = perGoal.toString();
    });
    setAmounts(next);
  };

  const confirm = () => {
    const allocations = goals
      .map((g) => ({ id: g.id, amount: parseFloat(amounts[g.id] ?? "0") || 0 }))
      .filter((a) => a.amount > 0);
    distributeContributions(allocations);
    router.back();
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.availableLabel, { color: textMuted }]}>
        {t("savings.available")}
      </Text>
      <Text style={styles.availableAmount}>{available.toFixed(2)} kr.</Text>
      <Text
        style={[
          styles.remaining,
          { color: remaining < 0 ? danger : textMuted },
        ]}
      >
        {remaining.toFixed(2)} kr. {t("savings.remainingToAllocate")}
      </Text>

      {goals.length > 1 && available > 0 && (
        <Pressable
          accessibilityRole="button"
          style={[
            styles.autoButton,
            {
              borderColor: accentTints.accent,
              backgroundColor: accentTints.accentSoft,
            },
          ]}
          onPress={distributeEqually}
        >
          <SymbolView
            name={{
              ios: "wand.and.stars",
              android: "auto_fix_high",
              web: "auto_fix_high",
            }}
            size={15}
            tintColor={accentTints.accent}
          />
          <Text style={[styles.autoButtonText, { color: accentTints.accent }]}>
            {t("savings.distributeEqually")}
          </Text>
        </Pressable>
      )}

      <FlatList
        data={goals}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <Text style={styles.goalName}>{item.name}</Text>
            <TextInput
              style={[styles.input, { borderColor, backgroundColor: surface }]}
              placeholder="0"
              placeholderTextColor={borderColor}
              keyboardType="decimal-pad"
              value={amounts[item.id] ?? ""}
              onChangeText={(v) =>
                setAmounts((prev) => ({ ...prev, [item.id]: v }))
              }
            />
          </Card>
        )}
      />

      <Button
        label={t("savings.distribute")}
        disabled={!canConfirm}
        onPress={confirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  availableLabel: { fontSize: 13, textAlign: "center" },
  availableAmount: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  remaining: { textAlign: "center", marginBottom: 12 },
  autoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  autoButtonText: { fontWeight: "700", fontSize: 13 },
  list: { gap: 10, marginBottom: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  goalName: { fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    width: 100,
    textAlign: "right",
  },
});

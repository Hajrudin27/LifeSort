import { economyTotalsForMonth } from "@/features/economy/monthlyTotals";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { minorUnitsToInputText } from "@/core/money/decimal";
import { decimalSeparatorFor, formatDkk, moneyLocaleFor } from "@/core/money/format";
import {
  addMinorUnits,
  divideMinorUnits,
  subtractMinorUnits,
  sumMinorUnits,
  ZERO_MINOR_UNITS,
  type MinorUnits,
} from "@/core/money/minorUnits";
import { parseSupportedMoneyInput } from "@/core/money/supportedMoney";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { allocationMovements, savingsMovementsAllowed } from "@/utils/savings/savingsGoalRules";
import { getMonthKey } from "@/utils/shared/monthKey";

export default function AllocateSavingsScreen() {
  const { t, i18n } = useTranslation();
  const locale = moneyLocaleFor(i18n.language);
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");

  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const currentMonthKey = getMonthKey(new Date());
  const expenses = useExpensesStore((s) => s.expenses);
  const goals = useSavingsGoalsStore((s) => s.goals);
  const extraSavings = useSavingsGoalsStore((s) => s.extraSavings);
  const distributeContributions = useSavingsGoalsStore(
    (s) => s.distributeContributions,
  );

  const totals = economyTotalsForMonth(expenses, incomeByMonth, currentMonthKey);
  const totalSaved = sumMinorUnits(goals.map((g) => g.savedAmount));
  const available = addMinorUnits(subtractMinorUnits(totals.balance, totalSaved), extraSavings);

  const [amounts, setAmounts] = useState<Record<string, string>>({});

  // APP-040: an empty field (or 0) allocates nothing; any other text must parse
  // exactly to supported money. APP-043: a negative amount is invalid rather than
  // silently lowering the total, and the store's own allocation rules (resulting
  // balances included) decide whether the rest can be confirmed.
  const parsedAmounts = goals.map((g) => {
    const text = amounts[g.id] ?? "";
    return { id: g.id, parsed: text.trim().length === 0 ? null : parseSupportedMoneyInput(text) };
  });
  const hasInvalidAmount = parsedAmounts.some(
    (a) => a.parsed !== null && (!a.parsed.ok || a.parsed.value < 0),
  );
  const allocations: { id: string; amount: MinorUnits }[] = parsedAmounts.flatMap((a) =>
    a.parsed?.ok && a.parsed.value > ZERO_MINOR_UNITS ? [{ id: a.id, amount: a.parsed.value }] : [],
  );
  const allocatedTotal = sumMinorUnits(allocations.map((a) => a.amount));
  const remaining = subtractMinorUnits(available, allocatedTotal);
  const canConfirm =
    !hasInvalidAmount &&
    allocations.length > 0 &&
    remaining >= 0 &&
    savingsMovementsAllowed(goals, () => allocationMovements(allocations));

  const distributeEqually = () => {
    if (goals.length === 0 || available <= 0) return;
    // Equal whole-øre shares. The remainder (fewer øre than there are goals)
    // stays visibly unallocated in "remaining", as the old floor-to-øre split did.
    const { share } = divideMinorUnits(available, goals.length);
    const next: Record<string, string> = {};
    goals.forEach((g) => {
      next[g.id] = minorUnitsToInputText(share, decimalSeparatorFor(locale));
    });
    setAmounts(next);
  };

  const confirm = () => {
    if (!canConfirm) return;
    distributeContributions(allocations);
    router.back();
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.availableLabel, { color: textMuted }]}>
        {t("savings.available")}
      </Text>
      <Text style={styles.availableAmount}>{formatDkk(available, locale)}</Text>
      <Text
        style={[
          styles.remaining,
          { color: remaining < 0 ? danger : textMuted },
        ]}
      >
        {formatDkk(remaining, locale)} {t("savings.remainingToAllocate")}
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
              accessibilityLabel={t("savings.a11y.allocationAmount", { name: item.name })}
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

import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { budgetPeriodForInstant } from "@/core/dates/budgetPeriod";
import { formatDkk, moneyLocaleFor } from "@/core/money/format";
import { absMinorUnits, MoneyError, type MinorUnits } from "@/core/money/minorUnits";
import {
  evaluatePurchaseImpact,
  purchaseAmountFromInput,
  type PurchaseImpact,
} from "@/features/economy/affordability";
import { usePreparedEconomyMonth } from "@/features/economy/currentPeriod";
import { economyTotalsForMonth } from "@/features/economy/monthlyTotals";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { formatMonthLabel, monthKeyToDate } from "@/utils/shared/monthKey";

/** Shown in full, always: APP-044 requires the assumptions to be visible. */
const ASSUMPTIONS = [
  "currentMonth",
  "registered",
  "noForecast",
  "noCredit",
  "savings",
  "notSaved",
  "sameFigures",
] as const;

const STATUS_KEYS = {
  "within-current-plan": "within",
  "over-current-plan": "over",
  "plan-incomplete": "incomplete",
} as const;

/**
 * APP-044 "Har jeg råd?" (docs/app-044-purchase-impact.md): a what-if on the
 * current plan. The purchase lives in this screen's state only; it is never
 * saved, synced or sent anywhere. The screen's only write is the inherited
 * APP-042 materialization (usePreparedEconomyMonth), which is the user's schedule, not the purchase.
 */
export default function PurchaseImpactScreen() {
  const { t, i18n } = useTranslation();
  const locale = moneyLocaleFor(i18n.language);
  const format = (amount: MinorUnits) => formatDkk(amount, locale);
  const backgroundColor = useThemeColor({}, "background");
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textColor = useThemeColor({}, "text");
  const textMuted = useThemeColor({}, "textMuted");
  const success = useThemeColor({}, "success");
  const warning = useThemeColor({}, "warning");
  const accentTints = useAccentTints();

  // One month per visit, so the plan, its label and the prepared month always
  // agree. APP-045: the Copenhagen month, the same rule as the Economy tab.
  const [monthKey] = useState(() => budgetPeriodForInstant(new Date()).monthKey);

  // No plan before the month is prepared: both stores read from disk (APP-014)
  // and this month's recurring costs materialized (APP-042), again whenever the
  // Expenses change. The typed amount is not a dependency, so typing never
  // triggers a pass.
  const planReady = usePreparedEconomyMonth(monthKey);

  const expenses = useExpensesStore((s) => s.expenses);
  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);

  // The canonical APP-039 totals, computed exactly as the Economy tab does.
  const plan = economyTotalsForMonth(expenses, incomeByMonth, monthKey);

  const [amountText, setAmountText] = useState("");
  const purchase = purchaseAmountFromInput(amountText);

  let impact: PurchaseImpact | null = null;
  let cannotCalculate = false;
  if (planReady && purchase !== null) {
    try {
      impact = evaluatePurchaseImpact(plan, purchase);
    } catch (error) {
      // Fail closed on an unsafe result: a fixed message, never a clamped number.
      if (!(error instanceof MoneyError)) throw error;
      cannotCalculate = true;
    }
  }

  const resultSentence = (result: PurchaseImpact): string => {
    switch (result.status) {
      case "plan-incomplete":
        return t("economy.affordability.result.incomplete");
      case "within-current-plan":
        return t("economy.affordability.result.within", { after: format(result.balanceAfter) });
      case "over-current-plan":
        // Below zero is stated as a distance from zero, e.g. "500 kr. under nul".
        return result.balanceBefore < 0
          ? t("economy.affordability.result.alreadyOver", {
              before: format(absMinorUnits(result.balanceBefore)),
              after: format(absMinorUnits(result.balanceAfter)),
            })
          : t("economy.affordability.result.over", {
              before: format(result.balanceBefore),
              after: format(absMinorUnits(result.balanceAfter)),
            });
    }
  };

  // Colour only supports the status text next to it; it never carries it alone.
  const statusTone =
    impact?.status === "within-current-plan"
      ? success
      : impact?.status === "over-current-plan"
        ? warning
        : textMuted;

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>{t("economy.affordability.intro")}</Text>

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t("economy.affordability.amountLabel")}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
          accessibilityLabel={t("economy.affordability.a11y.amount")}
          placeholder={t("economy.affordability.amountPlaceholder")}
          placeholderTextColor={textMuted}
          keyboardType="decimal-pad"
          value={amountText}
          onChangeText={setAmountText}
        />
        {amountText.trim() !== "" && purchase === null && (
          <Text accessibilityLiveRegion="polite" style={styles.hint}>
            {t("economy.affordability.amountInvalid")}
          </Text>
        )}
      </Card>

      <Card style={sharedStyles.card}>
        <View style={styles.cardHeader}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            {t("economy.affordability.planTitle")}
          </Text>
          <Text style={[styles.cardMeta, { color: textMuted }]}>{formatMonthLabel(monthKeyToDate(monthKey), locale)}</Text>
        </View>
        {planReady ? (
          <>
            <FactRow
              label={t("economy.affordability.incomeLabel")}
              value={plan.hasIncome ? format(plan.settledIncome) : t("economy.affordability.incomeMissing")}
            />
            <FactRow label={t("economy.affordability.spendingLabel")} value={format(plan.settledSpending)} />
            <FactRow
              label={t("economy.affordability.beforeLabel")}
              value={plan.hasIncome ? format(plan.balance) : t("economy.affordability.beforeUnavailable")}
              emphasis
            />
          </>
        ) : (
          <Text style={{ color: textMuted }}>{t("economy.affordability.loading")}</Text>
        )}
      </Card>

      {impact !== null && (
        <Card style={sharedStyles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            {t("economy.affordability.resultTitle")}
          </Text>
          <View style={styles.status}>
            <View style={[styles.statusDot, { backgroundColor: statusTone }]} />
            <Text style={styles.statusText}>{t(`economy.affordability.status.${STATUS_KEYS[impact.status]}`)}</Text>
          </View>
          <FactRow label={t("economy.affordability.purchaseLabel")} value={format(impact.purchaseAmount)} />
          {impact.status !== "plan-incomplete" && (
            <FactRow label={t("economy.affordability.afterLabel")} value={format(impact.balanceAfter)} emphasis />
          )}
          <Text style={styles.sentence}>{resultSentence(impact)}</Text>
          {impact.status === "plan-incomplete" && (
            <Pressable
              accessibilityRole="button"
              style={[styles.action, { borderColor: accentTints.accent }]}
              onPress={() => router.push({ pathname: "/expenses/income", params: { month: monthKey } })}
            >
              <Text style={[styles.actionText, { color: accentTints.accent }]}>{t("expenses.addIncome")}</Text>
            </Pressable>
          )}
        </Card>
      )}

      {cannotCalculate && (
        <Card style={sharedStyles.card}>
          <Text style={styles.sentence}>{t("economy.affordability.cannotCalculate")}</Text>
        </Card>
      )}

      <Card muted style={sharedStyles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {t("economy.affordability.assumptionsTitle")}
        </Text>
        {ASSUMPTIONS.map((key) => (
          <View key={key} style={styles.assumption}>
            <View style={[styles.bullet, { backgroundColor: textColor }]} />
            <Text style={styles.assumptionText}>{t(`economy.affordability.assumptions.${key}`)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

/** Label and value form one element, so a screen reader reads them together. */
function FactRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View accessible style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueEmphasis]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  cardHeader: { gap: 2, backgroundColor: "transparent" },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  cardMeta: { fontSize: 13, textTransform: "capitalize" },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    columnGap: 12,
    backgroundColor: "transparent",
  },
  rowLabel: { flexShrink: 1, fontSize: 14, lineHeight: 20 },
  rowValue: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  rowValueEmphasis: { fontSize: 16, fontWeight: "900" },
  status: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "transparent" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flexShrink: 1, fontSize: 14, fontWeight: "800" },
  sentence: { fontSize: 14, lineHeight: 20 },
  action: {
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  actionText: { fontSize: 14, fontWeight: "800" },
  assumption: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "transparent" },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  assumptionText: { flex: 1, fontSize: 13, lineHeight: 19 },
});

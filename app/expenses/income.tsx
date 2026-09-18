import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { minorUnitsToInputText } from "@/core/money/decimal";
import { parseSupportedMoneyInput } from "@/core/money/supportedMoney";
import { decimalSeparatorFor, moneyLocaleFor } from "@/core/money/format";
import { useIncomeStore } from "@/store/useIncomeStore";
import { budgetPeriodForInstant } from "@/core/dates/budgetPeriod";
import { formatMonthLabel, monthKeyToDate } from "@/utils/shared/monthKey";
import { Stack, useLocalSearchParams } from "expo-router";

export default function IncomeScreen() {
  const { t, i18n } = useTranslation();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");

  // APP-045: without an explicit month, the current Copenhagen budget month.
  const monthKey = month ?? budgetPeriodForInstant(new Date()).monthKey;
  // From the key's own fields: "YYYY-MM-01" parses as UTC and would title the
  // previous month on a device west of Greenwich.
  const monthDate = monthKeyToDate(monthKey);
  const locale = moneyLocaleFor(i18n.language);

  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const setIncomeForMonth = useIncomeStore((s) => s.setIncomeForMonth);
  const currentAmount = incomeByMonth[monthKey];

  const [amount, setAmount] = useState(
    currentAmount !== undefined ? minorUnitsToInputText(currentAmount, decimalSeparatorFor(locale)) : "",
  );

  // Eksisterende regel: ethvert gyldigt beløb, også nul, er en registreret indtægt.
  const parsedAmount = parseSupportedMoneyInput(amount);
  const canSave = parsedAmount.ok;

  const save = () => {
    if (!parsedAmount.ok) return;
    setIncomeForMonth(monthKey, parsedAmount.value);
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: formatMonthLabel(monthDate, locale) }} />

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t("expenses.incomeLabel")}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("expenses.incomeAmountPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          autoFocus
        />
      </Card>

      <Button label={t("expenses.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}
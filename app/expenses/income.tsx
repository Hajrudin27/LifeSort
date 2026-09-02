import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useIncomeStore } from "@/store/useIncomeStore";
import { formatMonthLabel, getMonthKey } from "@/utils/shared/monthKey";
import { Stack, useLocalSearchParams } from "expo-router";

export default function IncomeScreen() {
  const { t, i18n } = useTranslation();
  const { month } = useLocalSearchParams<{ month?: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");

  const monthKey = month ?? getMonthKey(new Date());
  const monthDate = new Date(`${monthKey}-01`);
  const locale = i18n.language === "da" ? "da-DK" : "en-US";

  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const setIncomeForMonth = useIncomeStore((s) => s.setIncomeForMonth);
  const currentAmount = incomeByMonth[monthKey];

  const [amount, setAmount] = useState(currentAmount?.toString() ?? "");

  const canSave = amount.trim().length > 0 && !isNaN(parseFloat(amount));

  const save = () => {
    setIncomeForMonth(monthKey, parseFloat(amount));
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
import { router, Stack } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useFoodStore } from "@/store/useFoodStore";
import { getMonthKey } from "@/utils/shared/monthKey";

export default function FoodBudgetScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");

  const monthKey = getMonthKey(new Date());
  const monthlyBudgetByMonth = useFoodStore((s) => s.monthlyBudgetByMonth);
  const setMonthlyBudget = useFoodStore((s) => s.setMonthlyBudget);

  const [amount, setAmount] = useState(monthlyBudgetByMonth[monthKey]?.toString() ?? "");

  const canSave = !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;

  const save = () => {
    setMonthlyBudget(monthKey, parseFloat(amount));
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: t("food.budgetLabel") }} />
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.monthlyBudgetPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          autoFocus
        />
      </Card>
      <Button label={t("food.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}
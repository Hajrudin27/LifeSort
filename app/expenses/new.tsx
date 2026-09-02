import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import CategoryPicker from "@/components/CategoryPicker";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useExpensesStore } from "@/store/useExpensesStore";
import { ExpenseCategory } from "@/types/expense";

export default function NewExpenseScreen() {
  const { t } = useTranslation();
  const addExpense = useExpensesStore((s) => s.addExpense);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const tint = useThemeColor({}, "tint");

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("subscription");
  const todayIso = new Date().toISOString().split("T")[0];
  const [nextPaymentDate, setNextPaymentDate] = useState(todayIso);
  const [isRecurring, setIsRecurring] = useState(false);

  const canSave = name.trim().length > 0 && !isNaN(parseFloat(amount));

  const save = () => {
    addExpense({ name: name.trim(), amount: parseFloat(amount), category, nextPaymentDate, isRecurring });
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("expenses.namePlaceholder")}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("expenses.amountPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />

        <Text style={sharedStyles.fieldLabel}>{t("expenses.nextPaymentLabel")}</Text>
        <DatePickerField value={nextPaymentDate} onChange={setNextPaymentDate} />

        <CategoryPicker selected={category} onSelect={setCategory} />

        <View style={sharedStyles.rowBetween}>
          <Text>{t("expenses.recurring")}</Text>
          <Switch value={isRecurring} onValueChange={setIsRecurring} trackColor={{ true: tint }} />
        </View>
      </Card>

      <Button label={t("expenses.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}
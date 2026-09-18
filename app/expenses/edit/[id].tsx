import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput } from "react-native";

import AttachmentList from "@/components/AttachmentList";
import Button from "@/components/Button";
import Card from "@/components/Card";
import CategoryPicker from "@/components/CategoryPicker";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import {
  DEFAULT_RECURRENCE_FREQUENCY,
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
} from "@/core/economy/recurrence";
import { minorUnitsToInputText } from "@/core/money/decimal";
import { parseSupportedMoneyInput } from "@/core/money/supportedMoney";
import { decimalSeparatorFor, moneyLocaleFor } from "@/core/money/format";
import { useExpensesStore } from "@/store/useExpensesStore";
import { ExpenseCategory } from "@/types/expense";

export default function EditExpenseScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const tint = useThemeColor({}, "tint");
  const backgroundColor = useThemeColor({}, "background");

  const expense = useExpensesStore((s) => s.expenses.find((e) => e.id === id));
  const updateExpense = useExpensesStore((s) => s.updateExpense);
  const removeExpense = useExpensesStore((s) => s.removeExpense);
  const deleteRecurringFromMonth = useExpensesStore((s) => s.deleteRecurringFromMonth);
  const addAttachment = useExpensesStore((s) => s.addAttachment);
  const removeAttachment = useExpensesStore((s) => s.removeAttachment);

  const [name, setName] = useState(expense?.name ?? "");
  const [amount, setAmount] = useState(
    expense ? minorUnitsToInputText(expense.amount, decimalSeparatorFor(moneyLocaleFor(i18n.language))) : "",
  );
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "subscription");
  const [nextPaymentDate, setNextPaymentDate] = useState(expense?.nextPaymentDate ?? "");
  const [isRecurring, setIsRecurring] = useState(expense?.isRecurring ?? false);
  // APP-042: en migreret række viser sin faktiske frekvens; nye valg er altid synlige.
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>(
    expense?.recurrenceFrequency ?? DEFAULT_RECURRENCE_FREQUENCY,
  );

  if (!expense) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t("expenses.emptyState")}</Text>
      </View>
    );
  }

  // Eksisterende regel: ethvert gyldigt beløb må gemmes her, også nul og negativt.
  const parsedAmount = parseSupportedMoneyInput(amount);
  const canSave = name.trim().length > 0 && parsedAmount.ok;

  const save = () => {
    if (!parsedAmount.ok) return;
    updateExpense(expense.id, {
      name: name.trim(),
      amount: parsedAmount.value,
      category,
      nextPaymentDate,
      isRecurring,
      // Slås gentagelsen fra, gemmes den uden frekvens; fremtidige måneder følger den nye værdi.
      recurrenceFrequency: isRecurring ? recurrenceFrequency : null,
    });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(
      t("expenses.deleteConfirmTitle"),
      expense.isRecurring ? t("expenses.deleteFutureConfirmMessage") : t("expenses.deleteConfirmMessage"),
      [
        { text: t("expenses.cancel"), style: "cancel" },
        {
          text: t("expenses.delete"),
          style: "destructive",
          onPress: () => {
            if (expense.isRecurring) {
              deleteRecurringFromMonth(expense.seriesId, expense.nextPaymentDate.slice(0, 7));
            } else {
              removeExpense(expense.id);
            }
            router.back();
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: expense.name }} />

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
          <Switch
            value={isRecurring}
            onValueChange={setIsRecurring}
            trackColor={{ true: tint }}
            accessibilityLabel={t("expenses.recurring")}
          />
        </View>

        {isRecurring && (
          <>
            <Text style={sharedStyles.fieldLabel}>{t("expenses.recurrenceFrequencyLabel")}</Text>
            <View style={sharedStyles.chipRow}>
              {RECURRENCE_FREQUENCIES.map((frequency) => {
                const selected = recurrenceFrequency === frequency;
                return (
                  <Pressable
                    key={frequency}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(`expenses.recurrence.${frequency}`)}
                    onPress={() => setRecurrenceFrequency(frequency)}
                    style={[
                      styles.frequencyChip,
                      { borderColor: selected ? tint : borderColor, backgroundColor: selected ? tint : surface },
                    ]}
                  >
                    {/* Markeringen står også i teksten, ikke kun i farven. */}
                    <Text style={{ color: selected ? "#FFFFFF" : undefined, fontWeight: selected ? "700" : "500" }}>
                      {selected ? `✓ ${t(`expenses.recurrence.${frequency}`)}` : t(`expenses.recurrence.${frequency}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t("expenses.attachmentsLabel")}</Text>
      <AttachmentList
        attachments={expense.attachments}
        onAdd={(a) => addAttachment(expense.id, a)}
        onRemove={(attachmentId) => removeAttachment(expense.id, attachmentId)}
      />

      <Button label={t("expenses.save")} disabled={!canSave} onPress={save} />
      <Button label={t("expenses.delete")} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frequencyChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
});
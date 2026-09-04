import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Switch, TextInput } from "react-native";

import AttachmentList from "@/components/AttachmentList";
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
  const allExpenses = useExpensesStore((s) => s.expenses);
  const addAttachment = useExpensesStore((s) => s.addAttachment);
  const removeAttachment = useExpensesStore((s) => s.removeAttachment);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const tint = useThemeColor({}, "tint");
  const backgroundColor = useThemeColor({}, "background");

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("subscription");
  const todayIso = new Date().toISOString().split("T")[0];
  const [nextPaymentDate, setNextPaymentDate] = useState(todayIso);
  const [isRecurring, setIsRecurring] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !isNaN(parseFloat(amount));

  const save = () => {
    const id = addExpense({ name: name.trim(), amount: parseFloat(amount), category, nextPaymentDate, isRecurring });
    setCreatedId(id);
  };

  const finish = () => {
    setCreatedId(null);
    router.back();
  };

  const createdExpense = allExpenses.find((e) => e.id === createdId);

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

      <Modal visible={createdId !== null} animationType="slide" transparent onRequestClose={finish}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor, borderColor }]}>
            <Text style={sharedStyles.sectionLabel}>{t("expenses.attachmentsLabel")}</Text>
            {createdExpense && (
              <AttachmentList
                attachments={createdExpense.attachments}
                onAdd={(a) => addAttachment(createdExpense.id, a)}
                onRemove={(attachmentId) => removeAttachment(createdExpense.id, attachmentId)}
              />
            )}
            <Button label={t("expenses.done")} onPress={finish} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = {
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
};  
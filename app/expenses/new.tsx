import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import AttachmentList from "@/components/AttachmentList";
import Button from "@/components/Button";
import CategoryPicker from "@/components/CategoryPicker";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor } from "@/components/Themed";
import Hero, { HeroBadge, HeroBadgeText } from "@/components/Hero";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useBrandTints } from "@/hooks/useBrandTints";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useToastStore } from "@/store/useToastStore";
import { ExpenseCategory } from "@/types/expense";


const pad = (value: number) => value.toString().padStart(2, "0");

function toISODate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function addMonths(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return toISODate(date);
}

function parseAmount(value: string) {
  const normalized = value.replace(",", ".").replace(/\s/g, "");
  return Number.parseFloat(normalized);
}

export default function NewExpenseScreen() {
  const { t } = useTranslation();
  const addExpense = useExpensesStore((s) => s.addExpense);
  const allExpenses = useExpensesStore((s) => s.expenses);
  const addAttachment = useExpensesStore((s) => s.addAttachment);
  const removeAttachment = useExpensesStore((s) => s.removeAttachment);
  const showToast = useToastStore((s) => s.show);
  const accentTints = useAccentTints();
  const brand = useBrandTints();
  const borderColor = useThemeColor({}, "border");
  const backgroundColor = useThemeColor({}, "background");
  const surface = useThemeColor({}, "surface");
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
  const textMuted = useThemeColor({}, "textMuted");
  const tint = useThemeColor({}, "tint");

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("subscription");
  const [nextPaymentDate, setNextPaymentDate] = useState(todayIso);
  const [paymentMode, setPaymentMode] = useState<"today" | "tomorrow" | "week" | "month" | "custom">("today");
  const [isRecurring, setIsRecurring] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const amountNumber = parseAmount(amount);
  const canSave = name.trim().length > 0 && Number.isFinite(amountNumber) && amountNumber > 0;
  const createdExpense = allExpenses.find((e) => e.id === createdId);
  const paymentShortcuts = [
    { key: "today", label: t("expenses.paymentToday"), value: addDays(0) },
    { key: "tomorrow", label: t("expenses.paymentTomorrow"), value: addDays(1) },
    { key: "week", label: t("expenses.paymentWeek"), value: addDays(7) },
    { key: "month", label: t("expenses.paymentMonth"), value: addMonths(1) },
  ] as const;

  const selectPaymentShortcut = (mode: (typeof paymentShortcuts)[number]["key"]) => {
    setPaymentMode(mode);
    setNextPaymentDate(paymentShortcuts.find((item) => item.key === mode)?.value ?? todayIso);
  };

  const openCustomDate = () => {
    setPaymentMode("custom");
    setNextPaymentDate((current) => current || todayIso);
  };

  const save = () => {
    if (!canSave) return;
    const id = addExpense({
      name: name.trim(),
      amount: amountNumber,
      category,
      nextPaymentDate,
      isRecurring,
    });
    showToast(t("expenses.createdToast"));
    setCreatedId(id);
  };

  const finish = () => {
    setCreatedId(null);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        <Hero
          variant="brand"
          icon={{ ios: "creditcard.fill", android: "credit_card", web: "credit_card" }}
          kicker={t("expenses.quickKicker")}
          title={t("expenses.quickTitle")}
          subtitle={t("expenses.quickSubtitle")}
          trailing={
            <HeroBadge>
              <HeroBadgeText>{t("expenses.currency")}</HeroBadgeText>
            </HeroBadge>
          }
        />

        <View style={styles.amountPanel}>
          <Text style={styles.sectionEyebrow}>{t("expenses.amountLabel")}</Text>
          <View style={[styles.amountInputWrap, { backgroundColor: surface, borderColor }]}>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <Text style={[styles.currencySuffix, { color: textMuted }]}>{t("expenses.currency")}</Text>
          </View>

          <Text style={styles.sectionEyebrow}>{t("expenses.nameLabel")}</Text>
          <TextInput
            style={[styles.nameInput, { borderColor, backgroundColor: surface }]}
            placeholder={t("expenses.namePlaceholder")}
            placeholderTextColor={textMuted}
            value={name}
            onChangeText={setName}
          />
        </View>

        <View style={styles.optionSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("expenses.categoryLabel")}</Text>
            <Text style={[styles.sectionMeta, { color: textMuted }]}>{t("expenses.categoryHelper")}</Text>
          </View>
          <CategoryPicker selected={category} onSelect={setCategory} />
        </View>

        <View style={styles.optionSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("expenses.nextPaymentLabel")}</Text>
            <Pressable accessibilityRole="button" style={[styles.customDateButton, { backgroundColor: surfaceMuted }]} onPress={openCustomDate}>
              <SymbolView name={{ ios: "calendar", android: "event", web: "event" }} size={14} tintColor={accentTints.accent} />
              <Text style={[styles.customDateText, { color: accentTints.accent }]}>{t("expenses.customDate")}</Text>
            </Pressable>
          </View>

          <View style={styles.paymentChips}>
            {paymentShortcuts.map((shortcut) => (
              <Pressable
                accessibilityRole="button"
                key={shortcut.key}
                style={[
                  styles.paymentChip,
                  {
                    backgroundColor: paymentMode === shortcut.key ? accentTints.accent : surface,
                    borderColor: paymentMode === shortcut.key ? accentTints.accent : borderColor,
                  },
                ]}
                onPress={() => selectPaymentShortcut(shortcut.key)}
              >
                <Text style={[styles.paymentChipText, { color: paymentMode === shortcut.key ? "#FFFFFF" : undefined }]}>
                  {shortcut.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {paymentMode === "custom" && (
            <DatePickerField value={nextPaymentDate} onChange={setNextPaymentDate} yearsBack={0} />
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          style={[styles.recurringCard, { borderColor: isRecurring ? tint : borderColor, backgroundColor: surface }]}
          onPress={() => setIsRecurring((current) => !current)}
        >
          <View style={[styles.recurringIcon, { backgroundColor: isRecurring ? tint : surfaceMuted }]}>
            <SymbolView
              name={{ ios: "arrow.triangle.2.circlepath", android: "sync", web: "sync" }}
              size={19}
              tintColor={isRecurring ? "#FFFFFF" : tint}
            />
          </View>
          <View style={styles.recurringTextGroup}>
            <Text style={styles.recurringTitle}>{t("expenses.recurring")}</Text>
            <Text style={[styles.recurringSubtitle, { color: textMuted }]}>{t("expenses.recurringHelper")}</Text>
          </View>
          <View style={[styles.toggleTrack, { backgroundColor: isRecurring ? tint : surfaceMuted }]}>
            <View style={[styles.toggleKnob, isRecurring && styles.toggleKnobActive]} />
          </View>
        </Pressable>

        <Button label={t("expenses.save")} disabled={!canSave} onPress={save} style={styles.saveButton} />
      </ScrollView>

      <Modal visible={createdId !== null} animationType="slide" transparent onRequestClose={finish}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor, borderColor }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={{ ios: "receipt.fill", android: "receipt_long", web: "receipt_long" }} size={20} tintColor={accentTints.accent} />
              </View>
              <View style={styles.modalTitleGroup}>
                <Text style={styles.modalTitle}>{t("expenses.receiptTitle")}</Text>
                <Text style={[styles.modalSubtitle, { color: textMuted }]}>{t("expenses.receiptSubtitle")}</Text>
              </View>
            </View>

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 16, gap: 16, paddingBottom: 44 },
  amountPanel: { gap: 9 },
  sectionEyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.62 },
  amountInputWrap: {
    minHeight: 76,
    borderWidth: 1.5,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  amountInput: { flex: 1, fontSize: 34, fontWeight: "800", paddingVertical: 12 },
  currencySuffix: { fontSize: 15, fontWeight: "800" },
  nameInput: {
    borderWidth: 1,
    borderRadius: 18,
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  optionSection: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  sectionMeta: { flex: 1, textAlign: "right", fontSize: 12, fontWeight: "700" },
  customDateButton: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  customDateText: { fontSize: 12, fontWeight: "800" },
  paymentChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  paymentChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  paymentChipText: { fontSize: 13, fontWeight: "800" },
  recurringCard: {
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recurringIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  recurringTextGroup: { flex: 1, gap: 2 },
  recurringTitle: { fontSize: 15, fontWeight: "800" },
  recurringSubtitle: { fontSize: 12, lineHeight: 17 },
  toggleTrack: { width: 45, height: 28, borderRadius: 14, padding: 3 },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF" },
  toggleKnobActive: { transform: [{ translateX: 17 }] },
  saveButton: { marginTop: 2 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  modalHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(120,110,100,0.28)",
    alignSelf: "center",
    marginBottom: 2,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  modalIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  modalTitleGroup: { flex: 1, gap: 2 },
  modalTitle: { fontSize: 18, fontWeight: "800" },
  modalSubtitle: { fontSize: 13, lineHeight: 18 },
});

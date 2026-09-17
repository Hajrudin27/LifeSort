import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Pressable, ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import ProgressBar from "@/components/ProgressBar";
import SavingsHistoryChart from "@/components/SavingsHistoryChart";
import SavingsIconPicker from "@/components/SavingsIconPicker";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { minorUnitsToInputText } from "@/core/money/decimal";
import { decimalSeparatorFor, formatDkk, moneyLocaleFor } from "@/core/money/format";
import { negateMinorUnits } from "@/core/money/minorUnits";
import { parseSupportedMoneyInput, supportedSumOrNull } from "@/core/money/supportedMoney";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { SavingsGoalIcon } from "@/types/savingsGoal";
import {
  estimateMonthsToGoal,
  monthlyRateForDisplay,
  requiredMonthlyAmount,
} from "@/utils/savings/savingsPace";
import { todayIso } from "@/utils/shared/localDate";

export default function SavingsGoalDetailScreen() {
  const { t, i18n } = useTranslation();
  const locale = moneyLocaleFor(i18n.language);
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");
  const warning = useThemeColor({}, "warning");

  const allGoals = useSavingsGoalsStore((s) => s.goals);
  const goal = allGoals.find((g) => g.id === id);
  const otherGoals = allGoals.filter((g) => g.id !== id);
  const allHistory = useSavingsGoalsStore((s) => s.history);
  const goalHistory = allHistory.filter((h) => h.goalId === id);

  const updateGoal = useSavingsGoalsStore((s) => s.updateGoal);
  const addContribution = useSavingsGoalsStore((s) => s.addContribution);
  const transferBetweenGoals = useSavingsGoalsStore(
    (s) => s.transferBetweenGoals,
  );
  const removeGoal = useSavingsGoalsStore((s) => s.removeGoal);

  const [name, setName] = useState(goal?.name ?? "");
  const [targetAmount, setTargetAmount] = useState(
    goal ? minorUnitsToInputText(goal.targetAmount, decimalSeparatorFor(locale)) : "",
  );
  const [icon, setIcon] = useState<SavingsGoalIcon>(goal?.icon ?? "other");
  const [hasDeadline, setHasDeadline] = useState(!!goal?.deadline);
  const [deadline, setDeadline] = useState(
    goal?.deadline ?? todayIso(),
  );
  const [contribution, setContribution] = useState("");
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState("");
  const [showEdit, setShowEdit] = useState(false);

  if (!goal) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t("savings.emptyState")}</Text>
      </View>
    );
  }

  // APP-040: text → supported DKK MinorUnits; the existing positive/limit rules are
  // unchanged, and a resulting balance the store would reject keeps the action disabled.
  const parsedTarget = parseSupportedMoneyInput(targetAmount);
  const canSave = name.trim().length > 0 && parsedTarget.ok && parsedTarget.value > 0;
  const parsedContribution = parseSupportedMoneyInput(contribution);
  const canContribute =
    parsedContribution.ok &&
    parsedContribution.value > 0 &&
    supportedSumOrNull(goal.savedAmount, parsedContribution.value) !== null;

  const parsedTransfer = parseSupportedMoneyInput(transferAmount);
  const validTransferAmount =
    parsedTransfer.ok &&
    parsedTransfer.value > 0 &&
    parsedTransfer.value <= goal.savedAmount &&
    supportedSumOrNull(goal.savedAmount, negateMinorUnits(parsedTransfer.value)) !== null;
  const transferGoal = otherGoals.find((g) => g.id === transferTarget);
  const canTransfer =
    transferGoal !== undefined &&
    validTransferAmount &&
    supportedSumOrNull(transferGoal.savedAmount, parsedTransfer.value) !== null;
  const canWithdraw = validTransferAmount;

  const estimatedMonths = estimateMonthsToGoal(goal, allHistory);
  const requiredMonthly = requiredMonthlyAmount(goal);
  const isBehindPace =
    requiredMonthly !== null &&
    estimatedMonths !== null &&
    estimatedMonths > 0 &&
    (() => {
      const now = new Date();
      const deadlineDate = goal.deadline ? new Date(goal.deadline) : null;
      if (!deadlineDate) return false;
      const monthsUntilDeadline = Math.max(
        1,
        (deadlineDate.getFullYear() - now.getFullYear()) * 12 +
          (deadlineDate.getMonth() - now.getMonth()),
      );
      return estimatedMonths > monthsUntilDeadline;
    })();

  const save = () => {
    if (!parsedTarget.ok) return;
    updateGoal(goal.id, {
      name: name.trim(),
      targetAmount: parsedTarget.value,
      icon,
      deadline: hasDeadline ? deadline : undefined,
    });
    setShowEdit(false);
    router.back();
  };

  const confirmContribution = () => {
    if (!parsedContribution.ok) return;
    addContribution(goal.id, parsedContribution.value);
    setContribution("");
  };

  const doTransfer = () => {
    if (!transferTarget || !parsedTransfer.ok) return;
    transferBetweenGoals(goal.id, transferTarget, parsedTransfer.value);
    setTransferAmount("");
    setTransferTarget(null);
  };

  const doWithdraw = () => {
    if (!parsedTransfer.ok) return;
    addContribution(goal.id, negateMinorUnits(parsedTransfer.value));
    setTransferAmount("");
  };

  const confirmDelete = () => {
    Alert.alert(
      t("savings.deleteConfirmTitle"),
      t("savings.deleteConfirmMessage"),
      [
        { text: t("savings.cancel"), style: "cancel" },
        {
          text: t("savings.delete"),
          style: "destructive",
          onPress: () => {
            removeGoal(goal.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: goal.name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowEdit(true)}
              style={styles.editButton}
            >
              <SymbolView
                name={{ ios: "pencil", android: "edit", web: "edit" }}
                size={20}
                tintColor={textMuted}
              />
              <Text style={{ color: textMuted }}>{t("warranties.edit")}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.progressCard}>
        <ProgressBar progress={goal.savedAmount / goal.targetAmount} />
        <Text style={[styles.progressText, { color: textMuted }]}>
          {formatDkk(goal.savedAmount, locale)} {t("savings.of")}{" "}
          {formatDkk(goal.targetAmount, locale)}
        </Text>
      </Card>

      {(estimatedMonths !== null || requiredMonthly !== null) && (
        <Card
          style={[
            styles.paceCard,
            { borderColor: isBehindPace ? warning : accentTints.accentSoft },
          ]}
        >
          <View style={styles.paceHeader}>
            <SymbolView
              name={{
                ios: "gauge.with.needle",
                android: "speed",
                web: "speed",
              }}
              size={16}
              tintColor={isBehindPace ? warning : accentTints.accent}
            />
            <Text
              style={[
                styles.paceTitle,
                { color: isBehindPace ? warning : accentTints.accent },
              ]}
            >
              {t("savings.paceTitle")}
            </Text>
          </View>

          {estimatedMonths !== null && estimatedMonths > 0 && (
            <Text style={styles.paceLine}>
              {t("savings.paceEstimate", { months: estimatedMonths })}
            </Text>
          )}
          {estimatedMonths === 0 && (
            <Text style={styles.paceLine}>{t("savings.paceReached")}</Text>
          )}

          {requiredMonthly !== null && requiredMonthly > 0 && (
            <Text
              style={[
                styles.paceLine,
                isBehindPace && { color: warning, fontWeight: "700" },
              ]}
            >
              {t("savings.paceRequired", {
                amount: formatDkk(monthlyRateForDisplay(requiredMonthly), locale),
              })}
            </Text>
          )}
        </Card>
      )}

      <Text style={sharedStyles.sectionLabel}>{t("savings.historyLabel")}</Text>
      <Card>
        <SavingsHistoryChart contributions={goalHistory} />
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t("savings.addMoney")}</Text>
      <View style={styles.row}>
        <TextInput
          style={[
            sharedStyles.input,
            styles.flexInput,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("savings.addMoneyPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={contribution}
          onChangeText={setContribution}
        />
        <Pressable
          accessibilityRole="button"
          style={[
            styles.smallButton,
            { borderColor },
            !canContribute && { opacity: 0.4 },
          ]}
          disabled={!canContribute}
          onPress={confirmContribution}
        >
          <Text style={styles.smallButtonText}>{t("savings.confirm")}</Text>
        </Pressable>
      </View>

      <Text style={sharedStyles.sectionLabel}>{t("savings.transfer")}</Text>
      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t("savings.addMoneyPlaceholder")}
        placeholderTextColor={borderColor}
        keyboardType="decimal-pad"
        value={transferAmount}
        onChangeText={setTransferAmount}
      />

      {otherGoals.length > 0 ? (
        <View style={sharedStyles.chipRow}>
          {otherGoals.map((g) => (
            <Chip
              key={g.id}
              label={g.name}
              active={transferTarget === g.id}
              onPress={() => setTransferTarget(g.id)}
            />
          ))}
        </View>
      ) : (
        <Text style={[styles.noOtherGoals, { color: textMuted }]}>
          {t("savings.noOtherGoals")}
        </Text>
      )}

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.smallButton,
            styles.flexButton,
            { borderColor },
            !canTransfer && { opacity: 0.4 },
          ]}
          disabled={!canTransfer}
          onPress={doTransfer}
        >
          <Text style={styles.smallButtonText}>
            {t("savings.transferButton")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.smallButton,
            styles.flexButton,
            { borderColor },
            !canWithdraw && { opacity: 0.4 },
          ]}
          disabled={!canWithdraw}
          onPress={doWithdraw}
        >
          <Text style={styles.smallButtonText}>{t("savings.withdraw")}</Text>
        </Pressable>
      </View>

      <Modal
        visible={showEdit}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEdit(false)}
      >
        <Pressable
          accessible={false}
          style={styles.modalBackdrop}
          onPress={() => setShowEdit(false)}
        >
          <Pressable
            accessible={false}
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView>
              <Card style={sharedStyles.card}>
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  value={name}
                  onChangeText={setName}
                />
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  keyboardType="decimal-pad"
                  value={targetAmount}
                  onChangeText={setTargetAmount}
                />

                <View style={sharedStyles.chipRow}>
                  <Chip
                    label={t("savings.setDeadlineToggle")}
                    active={hasDeadline}
                    onPress={() => setHasDeadline(!hasDeadline)}
                  />
                </View>
                {hasDeadline && (
                  <>
                    <Text style={sharedStyles.fieldLabel}>
                      {t("savings.deadlineLabel")}
                    </Text>
                    <DatePickerField value={deadline} onChange={setDeadline} />
                  </>
                )}

                <SavingsIconPicker selected={icon} onSelect={setIcon} />
              </Card>

              <Button
                label={t("savings.save")}
                disabled={!canSave}
                onPress={save}
              />
              <Button
                label={t("savings.delete")}
                variant="danger"
                onPress={confirmDelete}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  progressCard: { gap: 8 },
  progressText: { textAlign: "center" as const },
  paceCard: { gap: 4, borderWidth: 1.5 },
  paceHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  paceTitle: {
    fontWeight: "800" as const,
    fontSize: 13,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  paceLine: { fontSize: 13 },
  row: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const },
  flexInput: { flex: 1 },
  flexButton: { flex: 1 },
  smallButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center" as const,
  },
  smallButtonText: { fontWeight: "700" as const },
  noOtherGoals: { fontSize: 13 },
  editButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginRight: 8,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    maxHeight: "85%" as const,
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
};

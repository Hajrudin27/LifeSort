import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import SavingsIconPicker from "@/components/SavingsIconPicker";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { parseSupportedMoneyInput } from "@/core/money/supportedMoney";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { SavingsGoalIcon } from "@/types/savingsGoal";
import { isValidSavingsDeadline } from "@/utils/savings/savingsGoalRules";
import { todayIso } from "@/utils/shared/localDate";

export default function NewSavingsGoalScreen() {
  const { t } = useTranslation();
  const addGoal = useSavingsGoalsStore((s) => s.addGoal);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");

  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [icon, setIcon] = useState<SavingsGoalIcon>("other");
  // APP-043: the optional deadline can be set when the goal is created, as in edit.
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadline, setDeadline] = useState(todayIso());

  const parsedTarget = parseSupportedMoneyInput(targetAmount);
  const canSave =
    name.trim().length > 0 &&
    parsedTarget.ok &&
    parsedTarget.value > 0 &&
    (!hasDeadline || isValidSavingsDeadline(deadline));

  const save = () => {
    if (!parsedTarget.ok) return;
    addGoal({
      name: name.trim(),
      targetAmount: parsedTarget.value,
      icon,
      deadline: hasDeadline ? deadline : undefined,
    });
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Card style={sharedStyles.card}>
        <TextInput
          style={[
            sharedStyles.input,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("savings.namePlaceholder")}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[
            sharedStyles.input,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("savings.targetPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={targetAmount}
          onChangeText={setTargetAmount}
        />

        <View style={sharedStyles.chipRow}>
          <Chip
            label={t("savings.setDeadlineToggle")}
            accessibilityLabel={t("savings.setDeadlineToggle")}
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

      <Button label={t("savings.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}

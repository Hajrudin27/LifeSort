import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import SavingsIconPicker from "@/components/SavingsIconPicker";
import { useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { parseSupportedMoneyInput } from "@/core/money/supportedMoney";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { SavingsGoalIcon } from "@/types/savingsGoal";

export default function NewSavingsGoalScreen() {
  const { t } = useTranslation();
  const addGoal = useSavingsGoalsStore((s) => s.addGoal);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");

  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [icon, setIcon] = useState<SavingsGoalIcon>("other");

  const parsedTarget = parseSupportedMoneyInput(targetAmount);
  const canSave = name.trim().length > 0 && parsedTarget.ok && parsedTarget.value > 0;

  const save = () => {
    if (!parsedTarget.ok) return;
    addGoal({
      name: name.trim(),
      targetAmount: parsedTarget.value,
      icon,
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

        <SavingsIconPicker selected={icon} onSelect={setIcon} />
      </Card>

      <Button label={t("savings.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}

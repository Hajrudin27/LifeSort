import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useProfileStore } from "@/store/useProfileStore";

const PIN_LENGTH = 4;

export default function OnboardingPinScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, "border");
  const danger = useThemeColor({}, "danger");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");
  const tint = useThemeColor({}, "tint");

  const setPin = useProfileStore((s) => s.setPin);

  const [pin, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canSave = pin.length === PIN_LENGTH && pinConfirm.length === PIN_LENGTH;

  const save = async () => {
    if (pin.length !== PIN_LENGTH) {
      setPinError(t("appLock.pinLengthError", { length: PIN_LENGTH }));
      return;
    }
    if (pin !== pinConfirm) {
      setPinError(t("appLock.pinMismatchError"));
      return;
    }
    setPinError(null);
    setIsSaving(true);
    try {
      await setPin(pin);
      router.replace("/(tabs)");
    } finally {
      setIsSaving(false);
    }
  };
  // Ingen router.back her — dette er sidste trin i onboarding-kæden,
  // brugeren skal ende inde i selve appen, ikke tilbage til profil-trinnet.

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.welcomeTitle, { color: tint }]}>{t("appLock.createPinTitle")}</Text>
      <Text style={[styles.welcomeSubtitle, { color: textMuted }]}>{t("appLock.createPinSubtitle")}</Text>

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t("appLock.pinLabel")}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("appLock.pinPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_LENGTH}
          value={pin}
          onChangeText={setPinInput}
        />

        <Text style={sharedStyles.fieldLabel}>{t("appLock.confirmPinLabel")}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("appLock.confirmPinPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_LENGTH}
          value={pinConfirm}
          onChangeText={setPinConfirm}
        />
        <Text style={[styles.hint, { color: textMuted }]}>{t("appLock.pinHint")}</Text>

        {pinError && <Text style={{ color: danger, fontSize: 13 }}>{pinError}</Text>}
      </Card>

      <Button label={t("appLock.savePinButton")} disabled={!canSave || isSaving} onPress={save} />
    </ScrollView>
  );
}

const styles = {
  container: { padding: 16, gap: 16, paddingTop: 60, paddingBottom: 48 },
  welcomeTitle: { fontSize: 26, fontWeight: "800" as const },
  welcomeSubtitle: { fontSize: 14, marginTop: -8, marginBottom: 4 },
  hint: { fontSize: 12 },
};
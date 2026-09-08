import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useProfileStore } from "@/store/useProfileStore";
import { router } from "expo-router";


export default function OnboardingProfileScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, "border");
  const danger = useThemeColor({}, "danger");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");
  const tint = useThemeColor({}, "tint");

  const setName = useProfileStore((s) => s.setName);

  const [name, setLocalName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Begge felter er valgfrie. Onboarding er ikke et skema, der skal udfyldes,
  // før appen må bruges — det er et tilbud om at gøre den personlig.
  const canSave = true;

  const save = () => {
    setError(null);
    if (name.trim().length > 0) setName(name);
    // Videre til det spørgsmål, der faktisk former appen: hvad skal den hjælpe
    // med? Onboarding afsluttes dér (APP-020).
    router.push("/onboarding-modules");
  };
  // Ingen router.push/back her — RootLayoutNav opdager automatisk,
  // at onboarding er fuldført, og viser resten af appen i stedet.

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.welcomeTitle, { color: tint }]}>
        {t("profile.onboardingTitle")}
      </Text>
      <Text style={[styles.welcomeSubtitle, { color: textMuted }]}>
        {t("profile.onboardingSubtitle")}
      </Text>

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t("profile.nameLabel")}</Text>
        <TextInput
          style={[
            sharedStyles.input,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("profile.namePlaceholder")}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setLocalName}
        />

        {error && <Text style={{ color: danger, fontSize: 13 }}>{error}</Text>}
      </Card>

      <Button
        label={t("profile.continueButton")}
        disabled={!canSave}
        onPress={save}
      />
    </ScrollView>
  );
}

const styles = {
  container: { padding: 16, gap: 16, paddingTop: 60, paddingBottom: 48 },
  welcomeTitle: { fontSize: 26, fontWeight: "800" as const },
  welcomeSubtitle: { fontSize: 14, marginTop: -8, marginBottom: 4 },
  hint: { fontSize: 12 },
};
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useProfileStore } from "@/store/useProfileStore";
import { Gender } from "@/types/profile";
import { router } from "expo-router";

const GENDERS: Gender[] = ["female", "male", "other", "unspecified"];

export default function OnboardingProfileScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, "border");
  const danger = useThemeColor({}, "danger");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");
  const tint = useThemeColor({}, "tint");

  const setName = useProfileStore((s) => s.setName);
  const setAge = useProfileStore((s) => s.setAge);
  const setGender = useProfileStore((s) => s.setGender);

  const [name, setLocalName] = useState("");
  const [age, setLocalAge] = useState("");
  const [gender, setLocalGender] = useState<Gender>("unspecified");
  const [error, setError] = useState<string | null>(null);

  const parsedAge = parseInt(age, 10);
  const canSave = name.trim().length > 0 && !isNaN(parsedAge) && parsedAge > 0;

  const save = () => {
    if (name.trim().length === 0) {
      setError(t("profile.nameRequiredError"));
      return;
    }
    if (isNaN(parsedAge) || parsedAge <= 0) {
      setError(t("profile.ageRequiredError"));
      return;
    }
    setError(null);
    setName(name);
    setAge(parsedAge);
    setGender(gender);
    router.replace("/(tabs)");
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

        <Text style={sharedStyles.fieldLabel}>{t("profile.ageLabel")}</Text>
        <TextInput
          style={[
            sharedStyles.input,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("profile.agePlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          value={age}
          onChangeText={setLocalAge}
        />

        <Text style={sharedStyles.fieldLabel}>{t("profile.genderLabel")}</Text>
        <View style={sharedStyles.chipRow}>
          {GENDERS.map((g) => (
            <Chip
              key={g}
              label={t(`profile.gender.${g}`)}
              active={gender === g}
              onPress={() => setLocalGender(g)}
            />
          ))}
        </View>
        <Text style={[styles.hint, { color: textMuted }]}>
          {t("profile.genderHint")}
        </Text>

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
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useCareerStore } from "@/store/useCareerStore";

export default function CareerScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, "textMuted");
  const applications = useCareerStore((s) => s.applications);
  const skills = useCareerStore((s) => s.skills);

  return (
    <View style={sharedStyles.formContainer}>
      <Pressable accessibilityRole="button" onPress={() => router.push("/career/applications")}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t("career.applicationsLabel")}</Text>
          <Text style={{ color: textMuted }}>{applications.length}</Text>
        </Card>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/career/skills")}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t("career.skillsLabel")}</Text>
          <Text style={{ color: textMuted }}>{skills.length}</Text>
        </Card>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/career/cv')}>
  <Card style={sharedStyles.rowBetween}>
    <Text style={styles.linkText}>{t('career.cvLabel')}</Text>
  </Card>
</Pressable>
    </View>
  );
}

const styles = {
  linkText: { fontWeight: "700" as const },
};

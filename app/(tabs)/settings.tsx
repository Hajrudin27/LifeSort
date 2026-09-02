import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, Switch } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useAppLockStore } from "@/store/useAppLockStore";
import { useAuthStore } from "@/store/useAuthStore";
import { Language, useSettingsStore } from "@/store/useSettingsStore";
import { ThemeMode, useThemeStore } from "@/store/useThemeStore";

const THEME_OPTIONS: ThemeMode[] = ["light", "dark", "system"];
const LANGUAGE_OPTIONS: Language[] = ["da", "en"];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const signOut = useAuthStore((s) => s.signOut);
  const colorScheme = useColorScheme();
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, "border");
  const danger = useThemeColor({}, "danger");
  const textMuted = useThemeColor({}, "textMuted");

  const lockEnabled = useAppLockStore((s) => s.lockEnabled);
  const setLockEnabled = useAppLockStore((s) => s.setLockEnabled);
  const [hasBiometricHardware, setHasBiometricHardware] = useState(true);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(setHasBiometricHardware);
  }, []);

  const toggleLock = (value: boolean) => {
    if (value && !hasBiometricHardware) {
      Alert.alert(t("appLock.noHardwareTitle"), t("appLock.noHardwareMessage"));
      return;
    }
    setLockEnabled(value);
  };

  const handleSignOut = () => {
    Alert.alert(
      t("settings.signOutConfirmTitle"),
      t("settings.signOutConfirmMessage"),
      [
        { text: t("warranties.cancel"), style: "cancel" },
        {
          text: t("settings.signOutButton"),
          style: "destructive",
          onPress: signOut,
        },
      ],
    );
  };

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("settings.title")}</Text>

      <Text style={styles.sectionLabel}>{t("profile.title")}</Text>
      <Pressable onPress={() => router.push("/settings/profile")}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.rowLabel}>{t("profile.title")}</Text>
          <SymbolView
            name={{
              ios: "chevron.right",
              android: "chevron_right",
              web: "chevron_right",
            }}
            tintColor={borderColor}
            size={18}
          />
        </Card>
      </Pressable>

      <Text style={styles.sectionLabel}>{t("appLock.sectionLabel")}</Text>
      <Card style={sharedStyles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{t("appLock.toggleLabel")}</Text>
          <Text style={[styles.rowHint, { color: textMuted }]}>{t("appLock.toggleHint")}</Text>
        </View>
        <Switch
          value={lockEnabled}
          onValueChange={toggleLock}
          trackColor={{ true: accentTints.accent }}
        />
      </Card>
      <Pressable onPress={() => router.push("/settings/pin")}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.rowLabel}>{t("appLock.changePinLabel")}</Text>
          <SymbolView
            name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
            tintColor={borderColor}
            size={18}
          />
        </Card>
      </Pressable>

      <Text style={styles.sectionLabel}>{t("settings.languageLabel")}</Text>
      <View style={[styles.group, { borderColor }]}>
        {LANGUAGE_OPTIONS.map((option) => (
          <Pressable
            key={option}
            style={styles.row}
            onPress={() => changeLanguage(option)}
          >
            <Text style={styles.rowLabel}>
              {option === "da" ? t("language.danish") : t("language.english")}
            </Text>
            {language === option && (
              <SymbolView
                name={{ ios: "checkmark", android: "check", web: "check" }}
                tintColor={accentTints.accent}
                size={20}
              />
            )}
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t("settings.theme")}</Text>
      <View style={[styles.group, { borderColor }]}>
        {THEME_OPTIONS.map((option) => (
          <Pressable
            key={option}
            style={styles.row}
            onPress={() => setMode(option)}
          >
            <Text style={styles.rowLabel}>{t(`settings.${option}`)}</Text>
            {mode === option && (
              <SymbolView
                name={{ ios: "checkmark", android: "check", web: "check" }}
                tintColor={accentTints.accent}
                size={20}
              />
            )}
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t("backup.title")}</Text>
      <Pressable onPress={() => router.push("/settings/backup")}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.rowLabel}>{t("backup.title")}</Text>
          <SymbolView
            name={{
              ios: "chevron.right",
              android: "chevron_right",
              web: "chevron_right",
            }}
            tintColor={borderColor}
            size={18}
          />
        </Card>
      </Pressable>

      <Text style={styles.sectionLabel}>{t("settings.signOutButton")}</Text>
      <Pressable onPress={handleSignOut}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={[styles.rowLabel, { color: danger }]}>
            {t("settings.signOutButton")}
          </Text>
        </Card>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 60, gap: 4, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 24 },
  sectionLabel: {
    opacity: 0.6,
    fontSize: 13,
    marginBottom: 8,
    marginTop: 20,
    textTransform: "uppercase",
  },
  group: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLabel: { fontSize: 16 },
  rowHint: { fontSize: 12, marginTop: 2 },
});
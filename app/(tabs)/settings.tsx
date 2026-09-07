import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { Text, useThemeColor } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { useBrandTints } from "@/hooks/useBrandTints";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useSyncStatusStore } from "@/store/useSyncStatusStore";
import { useTabBarScroll } from "@/hooks/useTabBarScroll";
import { useAppLockStore } from "@/store/useAppLockStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { Language, useSettingsStore } from "@/store/useSettingsStore";
import { ThemeMode, useThemeStore } from "@/store/useThemeStore";

const THEME_OPTIONS: ThemeMode[] = ["light", "dark", "system"];
const LANGUAGE_OPTIONS: Language[] = ["da", "en"];

type IconName = { ios: string; android: string; web: string };

type SettingsRowProps = {
  danger?: boolean;
  description?: string;
  icon: IconName;
  onPress?: () => void;
  right?: ReactNode;
  title: string;
};

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "LifeSort";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const profile = useProfileStore((s) => s.profile);
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const accentTints = useAccentTints();
  const backgroundColor = useThemeColor({}, "background");
  const syncFailures = useSyncStatusStore((st) => st.failures);
  const lastSyncAt = useSyncStatusStore((st) => st.lastSuccessAt);
  const failedModules = Object.keys(syncFailures);
  const syncDescription = failedModules.length
    ? t("settings.syncPendingDescription", { count: failedModules.length })
    : lastSyncAt
      ? t("settings.syncLastDescription", {
          when: new Date(lastSyncAt).toLocaleString(i18n.language === "da" ? "da-DK" : "en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })
      : t("settings.syncNeverDescription");
  const brand = useBrandTints();
  const borderColor = useThemeColor({}, "border");
  const danger = useThemeColor({}, "danger");
  const surface = useThemeColor({}, "surface");
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
  const textMuted = useThemeColor({}, "textMuted");
  const handleTabBarScroll = useTabBarScroll();

  const lockEnabled = useAppLockStore((s) => s.lockEnabled);
  const setLockEnabled = useAppLockStore((s) => s.setLockEnabled);
  const [hasBiometricHardware, setHasBiometricHardware] = useState(true);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(setHasBiometricHardware);
  }, []);

  const profileName = profile.name ?? t("settings.profileFallbackName");
  const profileEmail = session?.user.email ?? t("settings.profileFallbackEmail");
  const initials = useMemo(
    () => getInitials(profile.name, session?.user.email),
    [profile.name, session?.user.email],
  );

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

  const renderRow = ({ danger: isDanger, description, icon, onPress, right, title }: SettingsRowProps) => {
    const content = (
      <>
        <View style={[styles.rowIcon, { backgroundColor: isDanger ? `${danger}14` : accentTints.accentSoft }]}>
          <SymbolView
            name={icon as any}
            size={17}
            tintColor={isDanger ? danger : accentTints.accent}
          />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowLabel, isDanger && { color: danger }]}>{title}</Text>
          {description && <Text style={[styles.rowHint, { color: textMuted }]}>{description}</Text>}
        </View>
        {right ?? (
          onPress && (
            <SymbolView
              name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
              tintColor={textMuted}
              size={17}
            />
          )
        )}
      </>
    );

    if (!onPress) {
      return <View style={styles.settingsRow}>{content}</View>;
    }

    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.settingsRow, pressed && styles.pressedRow]}
      >
        {content}
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor }]}
      contentContainerStyle={styles.content}
      onScroll={handleTabBarScroll}
      scrollEventThrottle={16}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/settings/profile")}
        style={({ pressed }) => [styles.profileCard, { backgroundColor: brand.ink }, pressed && styles.pressedCard]}
      >
        <View style={[styles.profileGlowRose, { backgroundColor: brand.glowPrimary }]} />
        <View style={[styles.profileGlowAmber, { backgroundColor: brand.glowSecondary }]} />
        <View style={styles.profileTopRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileEyebrow}>{t("settings.profileEyebrow")}</Text>
            <Text style={styles.profileName} numberOfLines={1}>{profileName}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{profileEmail}</Text>
          </View>
          <View style={styles.profileArrow}>
            <SymbolView
              name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
              tintColor="#FFFFFF"
              size={17}
            />
          </View>
        </View>
        <View style={styles.profileMetaRow}>
          <View style={styles.profilePill}>
            <SymbolView
              name={{ ios: "lock.shield.fill", android: "verified_user", web: "verified_user" }}
              size={12}
              tintColor="#FFFFFF"
            />
            <Text style={styles.profilePillText}>
              {lockEnabled ? t("settings.lockEnabledShort") : t("settings.lockDisabledShort")}
            </Text>
          </View>
          <View style={styles.profilePill}>
            <SymbolView
              name={{ ios: "person.crop.circle.fill", android: "person", web: "person" }}
              size={12}
              tintColor="#FFFFFF"
            />
            <Text style={styles.profilePillText}>{t("settings.accountReady")}</Text>
          </View>
        </View>
      </Pressable>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t("settings.accountSectionEyebrow")}</Text>
          <Text style={styles.sectionTitle}>{t("settings.accountSectionTitle")}</Text>
        </View>
        <View style={[styles.group, { backgroundColor: surface, borderColor }]}>
          {renderRow({
            icon: { ios: "person.fill", android: "person", web: "person" },
            title: t("profile.title"),
            description: t("settings.profileDescription"),
            onPress: () => router.push("/settings/profile"),
          })}
          {renderRow({
            icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" },
            title: t("modules.settingsTitle"),
            description: t("modules.settingsDescription"),
            onPress: () => router.push("/settings/modules"),
          })}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t("settings.securitySectionEyebrow")}</Text>
          <Text style={styles.sectionTitle}>{t("settings.securitySectionTitle")}</Text>
        </View>
        <View style={[styles.group, { backgroundColor: surface, borderColor }]}>
          {renderRow({
            icon: { ios: "lock.fill", android: "lock", web: "lock" },
            title: t("appLock.toggleLabel"),
            description: t("appLock.toggleHint"),
            right: (
              <Switch
                value={lockEnabled}
                onValueChange={toggleLock}
                trackColor={{ false: surfaceMuted, true: accentTints.accent }}
                thumbColor="#FFFFFF"
              />
            ),
          })}
          <View style={[styles.divider, { backgroundColor: borderColor }]} />
          {renderRow({
            icon: { ios: "number.square.fill", android: "pin", web: "pin" },
            title: t("appLock.changePinLabel"),
            description: t("settings.pinDescription"),
            onPress: () => router.push("/settings/pin"),
          })}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t("settings.appearanceSectionEyebrow")}</Text>
          <Text style={styles.sectionTitle}>{t("settings.appearanceSectionTitle")}</Text>
        </View>
        <View style={[styles.preferenceCard, { backgroundColor: surface, borderColor }]}>
          <View style={styles.preferenceHeader}>
            <View style={[styles.rowIcon, { backgroundColor: accentTints.accentSoft }]}>
              <SymbolView
                name={{ ios: "paintpalette.fill", android: "palette", web: "palette" }}
                size={17}
                tintColor={accentTints.accent}
              />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t("settings.theme")}</Text>
              <Text style={[styles.rowHint, { color: textMuted }]}>{t("settings.themeDescription")}</Text>
            </View>
          </View>
          <View style={[styles.segmented, { backgroundColor: surfaceMuted }]}>
            {THEME_OPTIONS.map((option) => {
              const selected = mode === option;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={option}
                  onPress={() => setMode(option)}
                  style={[styles.segment, selected && { backgroundColor: theme.text }]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.segmentText, { color: selected ? backgroundColor : textMuted }]}
                  >
                    {option === "system" ? t("settings.systemShort") : t(`settings.${option}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.preferenceCard, { backgroundColor: surface, borderColor }]}>
          <View style={styles.preferenceHeader}>
            <View style={[styles.rowIcon, { backgroundColor: accentTints.accentSoft }]}>
              <SymbolView
                name={{ ios: "globe.europe.africa.fill", android: "language", web: "language" }}
                size={17}
                tintColor={accentTints.accent}
              />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t("settings.languageLabel")}</Text>
              <Text style={[styles.rowHint, { color: textMuted }]}>{t("settings.languageDescription")}</Text>
            </View>
          </View>
          <View style={[styles.segmented, { backgroundColor: surfaceMuted }]}>
            {LANGUAGE_OPTIONS.map((option) => {
              const selected = language === option;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={option}
                  onPress={() => changeLanguage(option)}
                  style={[styles.segment, selected && { backgroundColor: theme.text }]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.segmentText, { color: selected ? backgroundColor : textMuted }]}
                  >
                    {option === "da" ? t("language.danish") : t("language.english")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t("settings.dataSectionEyebrow")}</Text>
          <Text style={styles.sectionTitle}>{t("settings.dataSectionTitle")}</Text>
        </View>
        <View style={[styles.group, { backgroundColor: surface, borderColor }]}>
          {renderRow({
            icon: { ios: "arrow.triangle.2.circlepath.circle.fill", android: "backup", web: "backup" },
            title: t("backup.title"),
            description: t("settings.backupDescription"),
            onPress: () => router.push("/settings/backup"),
          })}
          <View style={[styles.divider, { backgroundColor: borderColor }]} />
          {renderRow({
            icon: failedModules.length
              ? { ios: "exclamationmark.arrow.triangle.2.circlepath", android: "sync_problem", web: "sync_problem" }
              : { ios: "checkmark.icloud.fill", android: "cloud_done", web: "cloud_done" },
            title: t("settings.syncStatusTitle"),
            description: syncDescription,
          })}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionEyebrow, { color: danger }]}>{t("settings.dangerSectionEyebrow")}</Text>
          <Text style={styles.sectionTitle}>{t("settings.dangerSectionTitle")}</Text>
        </View>
        <View style={[styles.group, { backgroundColor: surface, borderColor }]}>
          {renderRow({
            danger: true,
            icon: { ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" },
            title: t("settings.signOutButton"),
            description: t("settings.signOutDescription"),
            onPress: handleSignOut,
          })}
          <View style={[styles.divider, { backgroundColor: borderColor }]} />
          {renderRow({
            danger: true,
            icon: { ios: "trash.fill", android: "delete", web: "delete" },
            title: t("deleteAccount.settingsLink"),
            description: t("settings.deleteAccountDescription"),
            onPress: () => router.push("/settings/delete-account"),
          })}
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 18, gap: 18, paddingBottom: 116 },
  profileCard: {
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 26,
    borderWidth: 1,
    gap: 18,
    overflow: "hidden",
    padding: 18,
    shadowColor: "#3B2C24",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
  },
  pressedCard: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  profileGlowRose: {
    borderRadius: 110,
    height: 220,
    opacity: 0.32,
    position: "absolute",
    right: -72,
    top: -92,
    width: 220,
  },
  profileGlowAmber: {
    borderRadius: 70,
    bottom: -58,
    height: 140,
    left: -42,
    opacity: 0.2,
    position: "absolute",
    width: 140,
  },
  profileTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 13,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 24,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileEyebrow: {
    color: "#FADBE3",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  profileName: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  profileEmail: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
  },
  profileArrow: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  profileMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  profilePill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.13)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  profilePillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    gap: 3,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
  },
  group: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  settingsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pressedRow: {
    opacity: 0.72,
  },
  rowIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: { fontSize: 16, fontWeight: "800" },
  rowHint: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  divider: {
    height: 1,
    marginLeft: 68,
    opacity: 0.7,
  },
  preferenceCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 14,
  },
  preferenceHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  segmented: {
    borderRadius: 18,
    flexDirection: "row",
    gap: 4,
    padding: 4,
  },
  segment: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 8,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: "900",
  },
});

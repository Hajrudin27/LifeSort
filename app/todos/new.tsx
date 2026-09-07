import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor } from "@/components/Themed";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useCycleStore } from "@/store/useCycleStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useTodoStore } from "@/store/useTodoStore";
import { useToastStore } from "@/store/useToastStore";
import { TodoImportance } from "@/types/life";
import { getPhaseForDate } from "@/utils/cycle/cycleInsights";

const IMPORTANCE_LEVELS: TodoImportance[] = ["low", "medium", "high"];
const BRAND_INK = "#16130F";
const BRAND_ROSE = "#E11D48";
const BRAND_AMBER = "#F59E0B";

const pad = (value: number) => value.toString().padStart(2, "0");

function toISODate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export default function NewTodoScreen() {
  const { t } = useTranslation();
  const addTodo = useTodoStore((s) => s.addTodo);
  const showToast = useToastStore((s) => s.show);
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, "border");
  const backgroundColor = useThemeColor({}, "background");
  const surface = useThemeColor({}, "surface");
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
  const textMuted = useThemeColor({}, "textMuted");
  const success = useThemeColor({}, "success");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [importance, setImportance] = useState<TodoImportance>("medium");
  const [dueDate, setDueDate] = useState("");
  const [dueMode, setDueMode] = useState<"none" | "today" | "tomorrow" | "week" | "custom">("none");

  const gender = useProfileStore((s) => s.profile.gender);
  const cycles = useCycleStore((s) => s.cycles);
  const avgCycleLength = useCycleStore((s) => s.avgCycleLength);
  const lutealPhaseLength = useCycleStore((s) => s.lutealPhaseLength);

  const dueDatePhase =
    gender === "female" && dueDate
      ? getPhaseForDate(dueDate, cycles, avgCycleLength, 5, lutealPhaseLength)
      : null;

  const canSave = title.trim().length > 0;
  const activeImportance = IMPORTANCE_LEVELS.find((level) => level === importance) ?? "medium";
  const dueShortcuts = [
    { key: "none", label: t("todos.dueShortcutNone"), value: "" },
    { key: "today", label: t("todos.dueShortcutToday"), value: addDays(0) },
    { key: "tomorrow", label: t("todos.dueShortcutTomorrow"), value: addDays(1) },
    { key: "week", label: t("todos.dueShortcutWeek"), value: addDays(7) },
  ] as const;

  const selectDueShortcut = (mode: (typeof dueShortcuts)[number]["key"]) => {
    setDueMode(mode);
    setDueDate(dueShortcuts.find((item) => item.key === mode)?.value ?? "");
  };

  const openCustomDate = () => {
    setDueMode("custom");
    setDueDate((current) => current || addDays(0));
  };

  const save = () => {
    addTodo({
      title: title.trim(),
      description: description.trim() || undefined,
      importance,
      dueDate: dueMode !== "none" && dueDate ? dueDate : undefined,
    });
    showToast(t("todos.createdToast"));
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
        <Card style={[styles.hero, { backgroundColor: BRAND_INK, overflow: "hidden" }]}>
          <View style={[styles.heroRoseGlow, { backgroundColor: BRAND_ROSE }]} />
          <View style={[styles.heroAmberGlow, { backgroundColor: BRAND_AMBER }]} />
          <View style={styles.heroIcon}>
            <SymbolView name={{ ios: "checklist", android: "checklist", web: "checklist" }} size={24} tintColor="#FFFFFF" />
          </View>
          <Text style={styles.heroKicker}>{t("todos.quickKicker")}</Text>
          <Text style={styles.heroTitle}>{t("todos.quickTitle")}</Text>
          <Text style={styles.heroSubtitle}>{t("todos.quickSubtitle")}</Text>
        </Card>

        <View style={styles.formSection}>
          <Text style={styles.sectionEyebrow}>{t("todos.titleLabel")}</Text>
          <TextInput
            style={[styles.titleInput, { borderColor, backgroundColor: surface }]}
            placeholder={t("todos.titlePlaceholder")}
            placeholderTextColor={textMuted}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />

          <Text style={styles.sectionEyebrow}>{t("todos.detailsLabel")}</Text>
          <TextInput
            style={[styles.descriptionInput, { borderColor, backgroundColor: surface }]}
            placeholder={t("todos.descriptionPlaceholder")}
            placeholderTextColor={textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>

        <View style={styles.optionSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("todos.importanceLabel")}</Text>
            <Text style={[styles.sectionMeta, { color: textMuted }]}>{t(`todos.importance.${activeImportance}`)}</Text>
          </View>

          <View style={styles.importanceGrid}>
            {IMPORTANCE_LEVELS.map((level) => {
              const active = importance === level;
              const tone = level === "high" ? BRAND_ROSE : level === "medium" ? BRAND_AMBER : success;
              return (
                <Pressable
                  key={level}
                  onPress={() => setImportance(level)}
                  style={[
                    styles.importanceCard,
                    { backgroundColor: active ? tone : surface, borderColor: active ? tone : borderColor },
                  ]}
                >
                  <SymbolView
                    name={{
                      ios: level === "high" ? "flame.fill" : level === "medium" ? "flag.fill" : "leaf.fill",
                      android: level === "high" ? "local_fire_department" : level === "medium" ? "flag" : "eco",
                      web: level === "high" ? "local_fire_department" : level === "medium" ? "flag" : "eco",
                    }}
                    size={19}
                    tintColor={active ? "#FFFFFF" : tone}
                  />
                  <Text style={[styles.importanceLabel, { color: active ? "#FFFFFF" : undefined }]}>
                    {t(`todos.importance.${level}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.optionSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("todos.dueQuickLabel")}</Text>
            <Pressable
              style={[styles.customDateButton, { backgroundColor: surfaceMuted }]}
              onPress={openCustomDate}
            >
              <SymbolView name={{ ios: "calendar", android: "event", web: "event" }} size={14} tintColor={accentTints.accent} />
              <Text style={[styles.customDateText, { color: accentTints.accent }]}>{t("todos.customDate")}</Text>
            </Pressable>
          </View>

          <View style={styles.dueChips}>
            {dueShortcuts.map((shortcut) => (
              <Chip
                key={shortcut.key}
                label={shortcut.label}
                active={dueMode === shortcut.key}
                onPress={() => selectDueShortcut(shortcut.key)}
              />
            ))}
          </View>

          {dueMode === "custom" && (
            <View style={styles.customDateWrap}>
              <DatePickerField value={dueDate || addDays(0)} onChange={setDueDate} yearsBack={0} />
            </View>
          )}

          {dueDatePhase === "menstrual" && (
            <View style={[styles.phaseHint, { backgroundColor: surfaceMuted }]}>
              <SymbolView name={{ ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={14} tintColor={BRAND_ROSE} />
              <Text style={[styles.phaseHintText, { color: textMuted }]}>{t("todos.dueDatePhaseHint")}</Text>
            </View>
          )}
        </View>

        <Button
          label={t("todos.save")}
          disabled={!canSave}
          onPress={save}
          style={styles.saveButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 16, gap: 16, paddingBottom: 44 },
  hero: { borderRadius: 24, gap: 8, padding: 20, position: "relative" },
  heroRoseGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, top: -82, right: -54, opacity: 0.25 },
  heroAmberGlow: { position: "absolute", width: 130, height: 130, borderRadius: 65, bottom: -48, left: -34, opacity: 0.18 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: 6,
  },
  heroKicker: {
    color: "#FFE4EA",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    backgroundColor: "transparent",
  },
  heroTitle: { color: "#FFFFFF", fontSize: 27, fontWeight: "800", backgroundColor: "transparent" },
  heroSubtitle: { color: "#FFFFFF", fontSize: 14, lineHeight: 20, opacity: 0.85, backgroundColor: "transparent" },
  formSection: { gap: 9 },
  sectionEyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.62 },
  titleInput: {
    borderWidth: 1.5,
    borderRadius: 18,
    fontSize: 20,
    fontWeight: "800",
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  descriptionInput: {
    borderWidth: 1,
    borderRadius: 18,
    fontSize: 15,
    minHeight: 98,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    textAlignVertical: "top",
  },
  optionSection: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  sectionMeta: { fontSize: 13, fontWeight: "700" },
  importanceGrid: { flexDirection: "row", gap: 10 },
  importanceCard: {
    flex: 1,
    minHeight: 82,
    borderWidth: 1.5,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  importanceLabel: { fontSize: 13, fontWeight: "800" },
  customDateButton: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  customDateText: { fontSize: 12, fontWeight: "800" },
  dueChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  customDateWrap: { gap: 8 },
  phaseHint: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  phaseHintText: { flex: 1, fontSize: 12, lineHeight: 17 },
  saveButton: { marginTop: 4 },
});

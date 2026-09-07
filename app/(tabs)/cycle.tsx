import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import CycleInsightsCard from "@/components/CycleInsightsCard";
import CycleMonthCalendar from "@/components/CycleMonthCalendar";
import CycleWheel from "@/components/CycleWheel";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import { CycleTints } from "@/constants/Colors";
import { sharedStyles } from "@/constants/sharedStyles";
import { useTabBarScroll } from "@/hooks/useTabBarScroll";
import { useCycleStore } from "@/store/useCycleStore";
import { FlowIntensity, Symptom } from "@/types/cycle";
import {
  getAverageCycleLength,
  getAveragePeriodLength,
  getCurrentCycleDay,
  getCurrentPhase,
  getDaysUntilNextPeriod,
  getFertileWindow,
  getPhaseForCycleDay,
  getPredictedNextPeriod,
  isCurrentlyOnPeriod,
} from "@/utils/cycle/cyclePredictions";
import { cancelCycleReminder, scheduleCycleReminder } from "@/utils/cycle/cycleReminder";
import { detectRecurringSymptoms } from "@/utils/cycle/symptomPatterns";

const SYMPTOMS: Symptom[] = [
  "cramps",
  "headache",
  "bloating",
  "fatigue",
  "moodSwings",
  "acne",
  "backache",
  "nausea",
  "tenderBreasts",
  "other",
];
const FLOWS: FlowIntensity[] = ["spotting", "light", "medium", "heavy"];

type LinkItem = {
  key: string;
  icon: { ios: string; android: string; web: string };
  label: string;
  count?: number;
  onPress: () => void;
};

export default function CycleScreen() {
  const { t, i18n } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const textMuted = useThemeColor({}, "textMuted");
  const warning = useThemeColor({}, "warning");
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const locale = i18n.language === "da" ? "da-DK" : "en-US";
  const handleTabBarScroll = useTabBarScroll();

  const cycles = useCycleStore((s) => s.cycles);
  const symptomLogs = useCycleStore((s) => s.symptomLogs);
  const avgCycleLength = useCycleStore((s) => s.avgCycleLength);
  const lutealPhaseLength = useCycleStore((s) => s.lutealPhaseLength);
  const reminderEnabled = useCycleStore((s) => s.reminderEnabled);
  const reminderDaysBefore = useCycleStore((s) => s.reminderDaysBefore);
  const startPeriod = useCycleStore((s) => s.startPeriod);
  const endPeriod = useCycleStore((s) => s.endPeriod);
  const logSymptoms = useCycleStore((s) => s.logSymptoms);
  const setAvgCycleLength = useCycleStore((s) => s.setAvgCycleLength);

  useEffect(() => {
    const computed = getAverageCycleLength(cycles);
    if (computed !== null) {
      setAvgCycleLength(computed);
    }
  }, [cycles]);

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  const cycleDay = getCurrentCycleDay(cycles, today);
  const onPeriod = isCurrentlyOnPeriod(cycles);
  const phase = getCurrentPhase(
    cycles,
    avgCycleLength,
    lutealPhaseLength,
    today,
  );
  const daysUntilNext = getDaysUntilNextPeriod(cycles, avgCycleLength, today);
  const fertileWindow = getFertileWindow(
    cycles,
    avgCycleLength,
    lutealPhaseLength,
  );
  const predictedNext = getPredictedNextPeriod(cycles, avgCycleLength);

  useEffect(() => {
    if (reminderEnabled && predictedNext) {
      scheduleCycleReminder(predictedNext, reminderDaysBefore, t('cycle.reminderNotifTitle'), t('cycle.reminderNotifBody'));
    } else {
      cancelCycleReminder();
    }
  }, [reminderEnabled, reminderDaysBefore, predictedNext]);

  const todayLog = symptomLogs.find((l) => l.date === todayKey);
  const [selectedSymptoms, setSelectedSymptoms] = useState<Symptom[]>(
    todayLog?.symptoms ?? [],
  );
  const [selectedFlow, setSelectedFlow] = useState<FlowIntensity | undefined>(
    todayLog?.flow,
  );
  const [notes, setNotes] = useState(todayLog?.notes ?? "");
  const [dismissedPattern, setDismissedPattern] = useState(false);

  const patterns = detectRecurringSymptoms(symptomLogs);

  const periodLength = getAveragePeriodLength(cycles);
  const fertileStartDay = fertileWindow
    ? Math.round(
        (new Date(fertileWindow.start).getTime() -
          new Date(
            cycles[cycles.length - 1]?.startDate ?? todayKey,
          ).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const fertileEndDay = fertileWindow
    ? Math.round(
        (new Date(fertileWindow.end).getTime() -
          new Date(
            cycles[cycles.length - 1]?.startDate ?? todayKey,
          ).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  const toggleSymptom = (s: Symptom) => {
    const next = selectedSymptoms.includes(s)
      ? selectedSymptoms.filter((x) => x !== s)
      : [...selectedSymptoms, s];
    setSelectedSymptoms(next);
    logSymptoms(todayKey, next, selectedFlow, notes.trim() || undefined);
  };

  const selectFlow = (f: FlowIntensity) => {
    const next = selectedFlow === f ? undefined : f;
    setSelectedFlow(next);
    logSymptoms(todayKey, selectedSymptoms, next, notes.trim() || undefined);
  };

  const saveNotes = () => {
    logSymptoms(
      todayKey,
      selectedSymptoms,
      selectedFlow,
      notes.trim() || undefined,
    );
  };

  const handlePeriodAction = () => {
    if (onPeriod) {
      const latest = [...cycles].sort((a, b) =>
        b.startDate.localeCompare(a.startDate),
      )[0];
      if (latest) endPeriod(latest.id, todayKey);
    } else {
      startPeriod(todayKey);
    }
  };

  const linkItems: LinkItem[] = [
    {
      key: "logDay",
      icon: { ios: "calendar.badge.plus", android: "event_note", web: "event_note" },
      label: t("cycle.logAnotherDayLabel"),
      onPress: () => router.push("/cycle/log-day"),
    },
    {
      key: "history",
      icon: { ios: "clock.arrow.circlepath", android: "history", web: "history" },
      label: t("cycle.historyLabel"),
      count: cycles.length,
      onPress: () => router.push("/cycle/history"),
    },
    {
      key: "symptoms",
      icon: { ios: "list.clipboard", android: "assignment", web: "assignment" },
      label: t("cycle.symptomHistoryLabel"),
      count: symptomLogs.length,
      onPress: () => router.push("/cycle/symptoms"),
    },
    {
      key: "healthInfo",
      icon: { ios: "heart.text.square", android: "health_and_safety", web: "health_and_safety" },
      label: t("healthInfo.title"),
      onPress: () => router.push("/cycle/health-info"),
    },
    {
      key: "settings",
      icon: { ios: "gearshape", android: "settings", web: "settings" },
      label: t("cycle.settingsLabel"),
      onPress: () => router.push("/cycle/settings"),
    },
  ];

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={styles.container}
      onScroll={handleTabBarScroll}
      scrollEventThrottle={16}
    >
      <Card
        style={[
          styles.hero,
          { backgroundColor: cycleTints.accent, overflow: "hidden" },
        ]}
      >
        <View
          style={[
            styles.heroCircleLarge,
            { backgroundColor: "#FFFFFF", opacity: 0.1 },
          ]}
        />
        <View
          style={[
            styles.heroCircleSmall,
            { backgroundColor: "#FFFFFF", opacity: 0.12 },
          ]}
        />
        <View style={styles.heroTopRow}>
          <SymbolView
            name={{
              ios: "drop.fill",
              android: "water_drop",
              web: "water_drop",
            }}
            size={18}
            tintColor="#FFFFFF"
          />
          <Text style={styles.heroKicker}>{t("cycle.title")}</Text>
        </View>
        {cycleDay !== null ? (
          <>
            <Text style={styles.heroDay}>
              {t("cycle.heroDayLabel", { day: cycleDay })}
            </Text>
            {phase && (
              <Text style={styles.heroPhase}>{t(`cycle.phase.${phase}`)}</Text>
            )}
            {daysUntilNext !== null && daysUntilNext > 0 && (
              <View style={styles.heroNextPill}>
                <Text style={styles.heroNext}>
                  {t("cycle.daysUntilNext", { days: daysUntilNext })}
                </Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.heroDay}>{t("cycle.heroNoData")}</Text>
        )}
      </Card>

      <Button
        label={
          onPeriod ? t("cycle.endPeriodButton") : t("cycle.startPeriodButton")
        }
        variant={onPeriod ? "secondary" : "primary"}
        onPress={handlePeriodAction}
      />

      <Text style={sharedStyles.sectionLabel}>
        {t("cycle.symptomsTodayLabel")}
      </Text>
      <Card style={styles.symptomsCard}>
        <View style={styles.symptomsKickerRow}>
          <SymbolView
            name={{ ios: "heart.text.square.fill", android: "assignment", web: "assignment" }}
            size={14}
            tintColor={cycleTints.accent}
          />
          <Text style={[styles.symptomsKicker, { color: cycleTints.accent }]}>
            {t("cycle.todayLogKicker")}
          </Text>
        </View>

        <Text style={[styles.subLabel, { color: textMuted }]}>
          {t("cycle.flowLabel")}
        </Text>
        <View style={sharedStyles.chipRow}>
          {FLOWS.map((f) => (
            <Chip
              key={f}
              label={t(`cycle.flow.${f}`)}
              active={selectedFlow === f}
              onPress={() => selectFlow(f)}
            />
          ))}
        </View>

        <Text style={[styles.subLabel, { color: textMuted }]}>
          {t("cycle.symptomsTodayLabel")}
        </Text>
        <View style={sharedStyles.chipRow}>
          {SYMPTOMS.map((s) => (
            <Chip
              key={s}
              label={t(`cycle.symptoms.${s}`)}
              active={selectedSymptoms.includes(s)}
              onPress={() => toggleSymptom(s)}
            />
          ))}
        </View>

        <Text style={[styles.subLabel, { color: textMuted }]}>
          {t("cycle.notesLabel")}
        </Text>
        <TextInput
          style={[
            sharedStyles.input,
            styles.notesInput,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("cycle.notesPlaceholder")}
          placeholderTextColor={borderColor}
          value={notes}
          onChangeText={setNotes}
          onBlur={saveNotes}
          multiline
        />
      </Card>

      {patterns.length > 0 && !dismissedPattern && (
        <Card style={[styles.patternCard, { borderColor: warning }]}>
          <View style={styles.patternHeader}>
            <SymbolView
              name={{
                ios: "lightbulb.fill",
                android: "lightbulb",
                web: "lightbulb",
              }}
              size={16}
              tintColor={warning}
            />
            <Text style={[styles.patternTitle, { color: warning }]}>
              {t("cycle.patternObservationTitle")}
            </Text>
          </View>
          <Text style={styles.patternBody}>
            {t("cycle.patternObservationBody", {
              symptom: t(`cycle.symptoms.${patterns[0].symptom}`).toLowerCase(),
              months: patterns[0].monthsInARow,
            })}
          </Text>
          <Pressable onPress={() => setDismissedPattern(true)}>
            <Text style={[styles.patternDismiss, { color: textMuted }]}>
              {t("cycle.patternObservationDismiss")}
            </Text>
          </Pressable>
        </Card>
      )}

      <CycleInsightsCard />

      <Text style={sharedStyles.sectionLabel}>{t("cycle.calendarLabel")}</Text>
      <Card>
        <CycleMonthCalendar
          cycles={cycles}
          fertileWindow={fertileWindow}
          predictedNext={predictedNext}
        />
      </Card>

      <Text style={sharedStyles.sectionLabel}>
        {t("cycle.cycleWheelLabel")}
      </Text>
      <Card style={{ alignItems: "center" }}>
        <CycleWheel
          cycleDay={cycleDay}
          avgCycleLength={avgCycleLength}
          periodLength={periodLength}
          fertileStartDay={fertileStartDay}
          fertileEndDay={fertileEndDay}
          daysUntilNext={daysUntilNext}
          getPhaseLabelForOffset={(offset) => {
            if (cycleDay === null) return "";
            const phaseForOffset = getPhaseForCycleDay(
              cycleDay + offset,
              avgCycleLength,
              periodLength,
              lutealPhaseLength,
            );
            return t(`cycle.phase.${phaseForOffset}`);
          }}
          locale={locale}
        />
      </Card>

      <Text style={sharedStyles.sectionLabel}>{t("cycle.moreLabel")}</Text>
      <View style={[styles.linkGroup, { borderColor: cycleTints.accentSoft }]}>
        {linkItems.map((item, index) => (
          <Pressable key={item.key} onPress={item.onPress}>
            <View
              style={[
                styles.linkRowItem,
                index !== linkItems.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: cycleTints.accentSoft,
                },
              ]}
            >
              <View style={styles.linkIconWrap}>
                <View style={[styles.linkIconGlow, { backgroundColor: cycleTints.accentSoft }]} />
                <View style={[styles.linkIconCircle, { backgroundColor: cycleTints.accent }]}>
                  <SymbolView name={item.icon as any} size={16} tintColor="#FFFFFF" />
                </View>
              </View>
              <Text style={styles.linkText}>{item.label}</Text>
              {item.count !== undefined && (
                <View style={[styles.countBadge, { backgroundColor: cycleTints.accentSoft }]}>
                  <Text style={[styles.countBadgeText, { color: cycleTints.accent }]}>{item.count}</Text>
                </View>
              )}
              <SymbolView
                name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                size={13}
                tintColor={textMuted}
              />
            </View>
          </Pressable>
        ))}
      </View>

      <View style={[styles.disclaimerBox, { backgroundColor: cycleTints.accentSoft }]}>
        <Text style={[styles.disclaimer, { color: textMuted }]}>
          {t("cycle.trackingDisclaimer")}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = {
  container: { padding: 16, gap: 14, paddingBottom: 48 },
  hero: { padding: 20, gap: 4, position: "relative" as const },
  heroCircleLarge: {
    position: "absolute" as const,
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -50,
    right: -40,
  },
  heroCircleSmall: {
    position: "absolute" as const,
    width: 80,
    height: 80,
    borderRadius: 40,
    bottom: -25,
    left: -15,
  },
  heroTopRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 6,
  },
  heroKicker: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700" as const,
    opacity: 0.85,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  heroDay: { fontSize: 24, fontWeight: "800" as const, color: "#FFFFFF" },
  heroPhase: { fontSize: 15, color: "#FFFFFF", opacity: 0.92, marginTop: 2 },
  heroNext: { fontSize: 12, color: "#FFFFFF", fontWeight: "700" as const },
  heroNextPill: {
    alignSelf: "flex-start" as const,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  symptomsCard: { gap: 10 },
  symptomsKickerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: -2 },
  symptomsKicker: { fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  subLabel: {
    fontSize: 12,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  notesInput: { minHeight: 60, textAlignVertical: "top" as const },
  patternCard: { borderWidth: 1.5, gap: 6 },
  patternHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  patternTitle: { fontWeight: "700" as const, fontSize: 13 },
  patternBody: { fontSize: 13, lineHeight: 18 },
  patternDismiss: { fontSize: 12, fontWeight: "600" as const, marginTop: 2 },
  linkGroup: {
    borderWidth: 1.5,
    borderRadius: 18,
    overflow: "hidden" as const,
  },
  linkRowItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  linkIconWrap: { width: 34, height: 34, alignItems: "center" as const, justifyContent: "center" as const },
  linkIconGlow: { position: "absolute" as const, width: 34, height: 34, borderRadius: 17 },
  linkIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  linkText: { fontWeight: "700" as const, fontSize: 14, flex: 1 },
  countBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: 6 },
  countBadgeText: { fontSize: 12, fontWeight: "800" as const },
  disclaimerBox: { borderRadius: 14, padding: 12, marginTop: 2 },
  disclaimer: { fontSize: 11, textAlign: "center" as const, lineHeight: 15 },
};

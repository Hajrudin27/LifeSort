import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import CycleInsightsCard from "@/components/CycleInsightsCard";
import CycleMonthCalendar from "@/components/CycleMonthCalendar";
import CycleWheel from "@/components/CycleWheel";
import { Text, useThemeColor } from "@/components/Themed";
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
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
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
  const predictedNextLabel = predictedNext
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(predictedNext))
    : t("cycle.noPredictionShort");

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

  const statusItems = [
    {
      key: "next",
      icon: { ios: "calendar.badge.clock", android: "event", web: "event" },
      label: t("cycle.nextPeriodShort"),
      value: predictedNextLabel,
      tone: cycleTints.period,
    },
    {
      key: "average",
      icon: { ios: "clock.fill", android: "schedule", web: "schedule" },
      label: t("cycle.averageShort"),
      value: t("cycle.cycleLengthLabel", { days: avgCycleLength }),
      tone: cycleTints.fertile,
    },
    {
      key: "logs",
      icon: { ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" },
      label: t("cycle.recordsShort"),
      value: String(symptomLogs.length),
      tone: cycleTints.ovulation,
    },
  ];

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={styles.container}
      onScroll={handleTabBarScroll}
      scrollEventThrottle={16}
    >
      <Card style={styles.hero}>
        <View style={[styles.heroGlow, styles.heroGlowRose]} />
        <View style={[styles.heroGlow, styles.heroGlowAmber]} />
        <View style={styles.heroTopRow}>
          <View style={styles.heroIcon}>
            <SymbolView
              name={{
                ios: "drop.fill",
                android: "water_drop",
                web: "water_drop",
              }}
              size={18}
              tintColor="#FFFFFF"
            />
          </View>
          <Text style={styles.heroKicker}>{t("cycle.overviewKicker")}</Text>
        </View>
        {cycleDay !== null ? (
          <>
            <Text style={styles.heroDay}>{t("cycle.heroDayLabel", { day: cycleDay })}</Text>
            <Text style={styles.heroPhase}>{phase ? t(`cycle.phase.${phase}`) : t("cycle.todayOverviewFallback")}</Text>
          </>
        ) : (
          <Text style={styles.heroDay}>{t("cycle.heroNoData")}</Text>
        )}
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>{t("cycle.nextPeriodShort")}</Text>
            <Text style={styles.heroStatValue}>{predictedNextLabel}</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>{t("cycle.statusShort")}</Text>
            <Text style={styles.heroStatValue}>
              {onPeriod ? t("cycle.onPeriodShort") : phase ? t(`cycle.phase.${phase}`) : t("cycle.noDataShort")}
            </Text>
          </View>
        </View>
      </Card>

      <View style={styles.statusGrid}>
        {statusItems.map((item) => (
          <View
            key={item.key}
            style={[styles.statusCard, { backgroundColor: surface, borderColor: `${item.tone}2E` }]}
          >
            <View style={[styles.statusIcon, { backgroundColor: `${item.tone}18` }]}>
              <SymbolView name={item.icon as any} size={15} tintColor={item.tone} />
            </View>
            <Text style={[styles.statusLabel, { color: textMuted }]}>{item.label}</Text>
            <Text style={styles.statusValue} numberOfLines={1}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.actionPanel, { backgroundColor: surface, borderColor }]}>
        <View style={styles.actionText}>
          <Text style={[styles.actionEyebrow, { color: cycleTints.accent }]}>{t("cycle.todayActionEyebrow")}</Text>
          <Text style={styles.actionTitle}>
            {onPeriod ? t("cycle.endPeriodActionTitle") : t("cycle.startPeriodActionTitle")}
          </Text>
          <Text style={[styles.actionSubtitle, { color: textMuted }]}>
            {onPeriod ? t("cycle.endPeriodActionSubtitle") : t("cycle.startPeriodActionSubtitle")}
          </Text>
        </View>
        <Button
          label={onPeriod ? t("cycle.endPeriodButton") : t("cycle.startPeriodButton")}
          variant={onPeriod ? "secondary" : "primary"}
          onPress={handlePeriodAction}
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionEyebrow, { color: cycleTints.accent }]}>{t("cycle.todayLogKicker")}</Text>
        <Text style={styles.sectionTitle}>{t("cycle.journalTitle")}</Text>
        <Text style={[styles.sectionSubtitle, { color: textMuted }]}>{t("cycle.journalSubtitle")}</Text>
      </View>
      <Card style={styles.symptomsCard}>
        <View style={styles.symptomsHeader}>
          <SymbolView
            name={{ ios: "heart.text.square.fill", android: "assignment", web: "assignment" }}
            size={17}
            tintColor={cycleTints.accent}
          />
          <Text style={styles.symptomsTitle}>{t("cycle.symptomsTodayLabel")}</Text>
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

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionEyebrow, { color: cycleTints.accent }]}>{t("cycle.timelineEyebrow")}</Text>
        <Text style={styles.sectionTitle}>{t("cycle.calendarLabel")}</Text>
      </View>
      <Card style={styles.visualCard}>
        <CycleMonthCalendar
          cycles={cycles}
          fertileWindow={fertileWindow}
          predictedNext={predictedNext}
        />
      </Card>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionEyebrow, { color: cycleTints.accent }]}>{t("cycle.exploreEyebrow")}</Text>
        <Text style={styles.sectionTitle}>{t("cycle.cycleWheelLabel")}</Text>
        <Text style={[styles.sectionSubtitle, { color: textMuted }]}>{t("cycle.wheelHelper")}</Text>
      </View>
      <Card style={styles.wheelCard}>
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

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionEyebrow, { color: cycleTints.accent }]}>{t("cycle.moreEyebrow")}</Text>
        <Text style={styles.sectionTitle}>{t("cycle.moreLabel")}</Text>
      </View>
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

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 116 },
  hero: {
    backgroundColor: "#16130F",
    borderColor: "rgba(255,255,255,0.08)",
    gap: 13,
    overflow: "hidden",
    padding: 20,
    position: "relative",
  },
  heroGlow: {
    position: "absolute",
  },
  heroGlowRose: {
    backgroundColor: "#E11D48",
    borderRadius: 112,
    height: 224,
    opacity: 0.34,
    right: -72,
    top: -88,
    width: 224,
  },
  heroGlowAmber: {
    backgroundColor: "#F59E0B",
    borderRadius: 74,
    bottom: -62,
    height: 148,
    left: -42,
    opacity: 0.2,
    width: 148,
  },
  heroTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  heroKicker: {
    color: "#FADBE3",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heroDay: { color: "#FFFFFF", fontSize: 42, fontWeight: "900" },
  heroPhase: { color: "rgba(255,255,255,0.78)", fontSize: 16, fontWeight: "700", marginTop: -8 },
  heroStats: {
    backgroundColor: "rgba(255,255,255,0.11)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 4,
    padding: 14,
  },
  heroStat: {
    flex: 1,
    gap: 3,
  },
  heroStatLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  heroStatValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  heroDivider: {
    backgroundColor: "rgba(255,255,255,0.14)",
    marginHorizontal: 12,
    width: 1,
  },
  statusGrid: {
    flexDirection: "row",
    gap: 10,
  },
  statusCard: {
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    minHeight: 112,
    padding: 12,
  },
  statusIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 32,
    justifyContent: "center",
    marginBottom: 12,
    width: 32,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: "900",
    minHeight: 24,
    textTransform: "uppercase",
  },
  statusValue: {
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  actionPanel: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  actionText: {
    gap: 4,
  },
  actionEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: "900",
  },
  actionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeader: {
    gap: 4,
    marginTop: 4,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "900",
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  symptomsCard: { gap: 13 },
  symptomsHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 2,
  },
  symptomsTitle: {
    fontSize: 17,
    fontWeight: "900",
  },
  subLabel: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  notesInput: { minHeight: 72, textAlignVertical: "top" },
  patternCard: { borderWidth: 1.5, gap: 6 },
  patternHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  patternTitle: { fontWeight: "800", fontSize: 13 },
  patternBody: { fontSize: 13, lineHeight: 18 },
  patternDismiss: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  visualCard: {
    padding: 14,
  },
  wheelCard: {
    alignItems: "center",
    paddingVertical: 18,
  },
  linkGroup: {
    borderWidth: 1.5,
    borderRadius: 22,
    overflow: "hidden",
  },
  linkRowItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  linkIconWrap: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  linkIconGlow: { borderRadius: 18, height: 36, position: "absolute", width: 36 },
  linkIconCircle: {
    alignItems: "center",
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  linkText: { flex: 1, fontWeight: "800", fontSize: 14 },
  countBadge: {
    alignItems: "center",
    borderRadius: 11,
    height: 22,
    justifyContent: "center",
    minWidth: 22,
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: 12, fontWeight: "900" },
  disclaimerBox: { borderRadius: 14, padding: 12, marginTop: 2 },
  disclaimer: { fontSize: 11, textAlign: "center", lineHeight: 15 },
});

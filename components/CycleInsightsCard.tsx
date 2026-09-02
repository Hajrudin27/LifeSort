import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import { CycleTints } from "@/constants/Colors";
import { useCycleStore } from "@/store/useCycleStore";
import { useFoodStore } from "@/store/useFoodStore";
import { useHabitsStore } from "@/store/useHabitsStore";
import { useTodoStore } from '@/store/useTodoStore';
import {
  computeAmountsByPhase,
  computeHabitRateByPhase,
  computeTodoOverdueRateByPhase,
  generateCycleInsights,
} from '@/utils/cycle/cycleInsights';

const PERIOD_LENGTH = 5;

export default function CycleInsightsCard() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const textMuted = useThemeColor({}, "textMuted");

  const cycles = useCycleStore((s) => s.cycles);
  const avgCycleLength = useCycleStore((s) => s.avgCycleLength);
  const lutealPhaseLength = useCycleStore((s) => s.lutealPhaseLength);
  const purchases = useFoodStore((s) => s.purchases);
  const habits = useHabitsStore((s) => s.habits);
  const todos = useTodoStore((s) => s.todos);

  const spendingByPhase = computeAmountsByPhase(
    purchases,
    cycles,
    avgCycleLength,
    PERIOD_LENGTH,
    lutealPhaseLength,
  );
  const habitRateByPhase = computeHabitRateByPhase(
    habits,
    cycles,
    avgCycleLength,
    PERIOD_LENGTH,
    lutealPhaseLength,
    new Date(),
  );
  const todoOverdueByPhase = computeTodoOverdueRateByPhase(
    todos,
    cycles,
    avgCycleLength,
    PERIOD_LENGTH,
    lutealPhaseLength,
    new Date(),
  );
  const insights = generateCycleInsights(
    spendingByPhase,
    habitRateByPhase,
    todoOverdueByPhase,
    cycles,
  );

  return (
    <View>
      <View style={[styles.headerBadge, { backgroundColor: cycleTints.accent }]}>
        <SymbolView
          name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }}
          size={13}
          tintColor="#FFFFFF"
        />
        <Text style={styles.headerBadgeText}>{t("cycle.insightsTitle")}</Text>
      </View>
      <Text style={[styles.subtitle, { color: textMuted }]}>
        {t("cycle.insightsSubtitle")}
      </Text>

      {insights.length === 0 ? (
        <Card style={[styles.emptyCard, { backgroundColor: cycleTints.accentSoft }]}>
          <Text style={{ color: textMuted, fontSize: 13, textAlign: 'center' }}>
            {t("cycle.insightsEmpty")}
          </Text>
        </Card>
      ) : (
        insights.map((insight, i) => (
          <View key={i} style={[styles.insightCard, { backgroundColor: cycleTints.accentSoft, borderColor: cycleTints.accent }]}>
            <View style={[styles.insightIconCircle, { backgroundColor: cycleTints.accent }]}>
              <SymbolView
                name={{ ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' }}
                size={13}
                tintColor="#FFFFFF"
              />
            </View>
            <Text style={styles.insightText}>
              {t(`cycle.insights.${insight.key}`, {
                percent: insight.percent,
                phase: t(`cycle.phase.${insight.phase}`).toLowerCase(),
              })}
            </Text>
          </View>
        ))
      )}

      <Text style={[styles.disclaimer, { color: textMuted }]}>
        {t("cycle.insightsDisclaimer")}
      </Text>
    </View>
  );
}

const styles = {
  headerBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: 'flex-start' as const,
    gap: 6,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  headerBadgeText: { color: '#FFFFFF', fontWeight: "800" as const, fontSize: 12 },
  subtitle: { fontSize: 12, marginBottom: 10 },
  emptyCard: { alignItems: "center" as const, borderRadius: 16 },
  insightCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  insightIconCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
  insightText: { fontSize: 13, lineHeight: 18, fontWeight: "600" as const, flex: 1 },
  disclaimer: { fontSize: 10, marginTop: 6 },
};
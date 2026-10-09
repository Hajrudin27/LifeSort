import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { habitPeriodSummary, type HabitPeriodKind } from '@/features/habits/domain/habitPeriodSummary';
import type { Habit } from '@/types/life';

const KINDS: HabitPeriodKind[] = ['week', 'month'];
const CHECK = { ios: 'checkmark', android: 'check', web: 'check' };

/**
 * APP-066. Plain counts of what has been recorded so far this week or this month, at the top of
 * the Habits list and nowhere else. Integers only: no percentage, ring, score or colour judgment.
 * A scheduled day that has not been resolved yet (today) is not in the numbers. Selection is
 * shown by a check mark and bold text as well as fill, and read out as `selected`.
 */
export default function HabitPeriodSummaryCard({ habits, today }: { habits: readonly Habit[]; today: string }) {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const [kind, setKind] = useState<HabitPeriodKind>('week');
  const summary = useMemo(() => habitPeriodSummary(habits, kind, today), [habits, kind, today]);
  const { scheduled, otherEntries } = summary;
  const empty = scheduled.total === 0 && otherEntries === 0;

  return (
    <Card style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{t(`habits.summary.title.${kind}`)}</Text>

      <View accessibilityRole="radiogroup" accessibilityLabel={t('habits.summary.selectorLabel')} style={styles.selector}>
        {KINDS.map((option) => (
          <Chip
            key={option}
            label={t(`habits.summary.kind.${option}`)}
            active={kind === option}
            icon={kind === option ? CHECK : undefined}
            accessibilityRole="radio"
            accessibilityState={{ checked: kind === option, selected: kind === option }}
            style={styles.option}
            onPress={() => setKind(option)}
          />
        ))}
      </View>

      {empty ? (
        <Text style={[styles.line, { color: textMuted }]}>{t(`habits.summary.empty.${kind}`)}</Text>
      ) : (
        <View style={styles.facts}>
          {scheduled.total > 0 && (
            <Text style={styles.line}>{t('habits.summary.scheduled', { done: scheduled.completed, count: scheduled.total })}</Text>
          )}
          {otherEntries > 0 && <Text style={styles.line}>{t('habits.summary.other', { count: otherEntries })}</Text>}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700' },
  selector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  facts: { gap: 4 },
  line: { fontSize: 15, lineHeight: 21 },
});

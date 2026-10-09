import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { habitStreak } from '@/features/habits/domain/habitStreak';
import { useHabitPreferencesStore } from '@/store/useHabitPreferencesStore';
import type { Habit } from '@/types/life';

/**
 * APP-065. The optional streak, on the habit's own detail screen and nowhere else. Off until the
 * user turns it on for this habit; a number appears only for a habit scheduled on specific days,
 * and never as "0" — a count of zero is explained, not scored. Calm styling throughout: no
 * colour, icon or wording that treats a run ending as a failure.
 */
export default function HabitStreakCard({ habit, today }: { habit: Habit; today: string }) {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const enabled = useHabitPreferencesStore((s) => s.streakEnabledHabitIds.includes(habit.id));
  const setStreakEnabled = useHabitPreferencesStore((s) => s.setStreakEnabled);
  const streak = useMemo(() => habitStreak(habit, today), [habit, today]);
  const kind = habit.direction === 'build' ? 'Build' : 'Quit';

  // What sits under the switch: a number, or a plain sentence about why there is none.
  let count: number | null = null;
  let note: string | null = null;
  if (streak.kind === 'ineligible') note = t(enabled ? 'habits.streak.ineligibleEnabled' : 'habits.streak.ineligible');
  else if (enabled && streak.count > 0) count = streak.count;
  else if (enabled) note = t(`habits.streak.zero${kind}`);

  return (
    <Card style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{t('habits.streak.title')}</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>{t('habits.streak.switchLabel')}</Text>
          <Text style={[styles.hint, { color: textMuted }]}>{t('habits.streak.switchHint')}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(next) => setStreakEnabled(habit.id, next)}
          accessibilityRole="switch"
          accessibilityLabel={t('habits.streak.switchLabel')}
          accessibilityHint={t('habits.streak.switchHint')}
          accessibilityState={{ checked: enabled }}
          style={styles.switch}
        />
      </View>

      {count !== null && <Text style={styles.count}>{t(`habits.streak.count${kind}`, { count })}</Text>}
      {note && <Text style={[styles.hint, { color: textMuted }]}>{note}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17 },
  switch: { minHeight: 44, minWidth: 44 },
  count: { fontSize: 16, fontWeight: '700' },
});

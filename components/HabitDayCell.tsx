import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { HabitError } from '@/features/habits/domain/habitCommands';
import { habitDayStatus, hasEntryOn } from '@/features/habits/domain/habitStatus';
import { dayAccessibilityLabel, dayAction, STATUS_GLYPH } from '@/features/habits/habitDisplay';
import { CELL_INSET, MIN_TARGET } from '@/components/habitGrid';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHabitsStore } from '@/store/useHabitsStore';
import type { Habit } from '@/types/life';

type Props = {
  habit: Habit;
  /** The real calendar date this cell stands for. */
  date: string;
  today: string;
  /** What is drawn in the cell: a weekday letter or the day of the month. */
  label: string;
};

/**
 * One real date of one habit. Its state is told three ways that do not rely on colour: a glyph
 * (✓ completed, – not completed, ○ scheduled today), the border style (dashed for upcoming) and
 * the full spoken label ("Wednesday 7 October, scheduled, completed"). It is a checkbox: checked
 * when there is an entry, disabled when the domain would refuse a change.
 *
 * The target is at least 44pt tall and, from `NARROWEST_FULL_TARGET_SCREEN` wide upward, at least 44pt
 * wide: the whole column is the tap area and the visible gap is drawn inside it (habitGrid.ts). On a
 * narrower screen the width falls short; that is recorded as a manual device check, not claimed.
 */
export default function HabitDayCell({ habit, date, today, label }: Props) {
  const { t, i18n } = useTranslation();
  const tint = useAccentTints().accent;
  const border = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');
  const setHabitDateCompleted = useHabitsStore((s) => s.setHabitDateCompleted);

  const status = habitDayStatus(habit, date, today);
  const action = dayAction(habit, date, today);
  const done = hasEntryOn(habit, date);
  const filled = status === 'completed' || (done && status === 'future');

  const press = () => {
    try {
      setHabitDateCompleted(habit.id, date, action === 'mark');
    } catch (error) {
      // The domain refused (a stale screen, a clock that moved): nothing changed, nothing to show.
      if (!(error instanceof HabitError)) throw error;
    }
  };

  const hint = action === 'mark' ? t(`habits.a11y.hintMark.${habit.direction}`) : action === 'clear' ? t('habits.a11y.hintClear') : undefined;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={dayAccessibilityLabel(habit, date, today, t, i18n.language)}
      accessibilityHint={hint}
      accessibilityState={{ checked: done, disabled: action === 'none' }}
      disabled={action === 'none'}
      onPress={press}
      style={styles.target}>
      <View
        style={[
          styles.cell,
          {
            backgroundColor: filled ? tint : surfaceMuted,
            borderColor: status === 'pending' ? tint : status === 'missed' ? textMuted : border,
            borderWidth: status === 'pending' ? 2 : status === 'before-start' ? 0 : 1,
            borderStyle: status === 'future' ? 'dashed' : 'solid',
            opacity: status === 'before-start' ? 0.35 : status === 'future' && !done ? 0.6 : 1,
          },
        ]}>
        <Text style={[styles.label, { color: filled ? '#FFFFFF' : textMuted }]}>{label}</Text>
        <Text style={[styles.glyph, { color: filled ? '#FFFFFF' : textMuted }]}>{filled ? STATUS_GLYPH.completed : STATUS_GLYPH[status]}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The whole column is the tap area; the visible gap between cells is this inset, not a gap between Pressables.
  target: { flex: 1, minHeight: MIN_TARGET, padding: CELL_INSET },
  cell: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  label: { fontSize: 12, fontWeight: '700' },
  glyph: { fontSize: 12, fontWeight: '800', minHeight: 14 },
});

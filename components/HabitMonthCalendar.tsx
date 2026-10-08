import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import HabitDayCell from '@/components/HabitDayCell';
import { GRID_BLEED } from '@/components/habitGrid';
import { Text, useThemeColor } from '@/components/Themed';
import { monthText, STATUS_GLYPH, weekdayText } from '@/features/habits/habitDisplay';
import { useToday } from '@/hooks/useToday';
import type { Habit, IsoWeekday } from '@/types/life';
import { getMonthCalendarWeeks, shiftMonthKey } from '@/utils/habit/habitMonth';

type Props = {
  habit: Habit;
};

const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const LEGEND = ['completed', 'missed', 'pending', 'optional'] as const;

/**
 * The habit's history, one month at a time, from the month it started to today's month (or
 * the latest month that holds an entry, so an entry dated in the future can still be reached
 * and cleared). Each real date is a HabitDayCell; the legend below names the shapes.
 */
export default function HabitMonthCalendar({ habit }: Props) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');

  const minMonthKey = habit.startDate.slice(0, 7);
  const latestEntry = habit.logs.reduce((latest, log) => (log.date > latest ? log.date : latest), today);
  const maxMonthKey = latestEntry.slice(0, 7);

  const [requested, setRequested] = useState(() => today.slice(0, 7));
  const monthKey = requested < minMonthKey ? minMonthKey : requested > maxMonthKey ? maxMonthKey : requested;

  const canGoBack = monthKey > minMonthKey;
  const canGoForward = monthKey < maxMonthKey;
  const weeks = getMonthCalendarWeeks(monthKey, today);

  return (
    <View>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y.previousMonth')}
          accessibilityState={{ disabled: !canGoBack }}
          disabled={!canGoBack}
          style={styles.navButton}
          onPress={() => setRequested(shiftMonthKey(monthKey, -1))}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
            size={20}
            tintColor={canGoBack ? textMuted : borderColor}
          />
        </Pressable>
        <Text style={styles.monthLabel} accessibilityRole="header">{monthText(monthKey, i18n.language)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y.nextMonth')}
          accessibilityState={{ disabled: !canGoForward }}
          disabled={!canGoForward}
          style={styles.navButton}
          onPress={() => setRequested(shiftMonthKey(monthKey, 1))}>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={20}
            tintColor={canGoForward ? textMuted : borderColor}
          />
        </Pressable>
      </View>

      <View style={styles.weekdayRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {WEEKDAYS.map((weekday) => (
          <Text key={weekday} style={[styles.weekdayLabel, { color: textMuted }]}>
            {weekdayText(weekday, 'narrow', t)}
          </Text>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((day, dayIndex) =>
            day.key === null ? (
              <View key={dayIndex} style={styles.blank} />
            ) : (
              <HabitDayCell key={day.key} habit={habit} date={day.key} today={today} label={String(day.dayNumber)} />
            ),
          )}
        </View>
      ))}

      <View style={styles.legend}>
        {LEGEND.map((status) => (
          <Text key={status} style={[styles.legendItem, { color: textMuted }]}>
            {STATUS_GLYPH[status]} {t(`habits.legend.${status}`)}
          </Text>
        ))}
        <Text style={[styles.legendItem, { color: textMuted }]}>┄ {t('habits.legend.future')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  navButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontWeight: '700', textTransform: 'capitalize' },
  weekdayRow: { flexDirection: 'row', marginHorizontal: -GRID_BLEED, marginBottom: 2 },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  weekRow: { flexDirection: 'row', marginHorizontal: -GRID_BLEED },
  blank: { flex: 1, minHeight: 44 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { fontSize: 11 },
});

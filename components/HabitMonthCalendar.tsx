import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHabitsStore } from '@/store/useHabitsStore';
import { Habit } from '@/types/life';
import { getMonthCalendarWeeks, getWeekdayNarrowLabels } from '@/utils/habit/habitMonth';
import { addMonths, formatMonthLabel, getMonthKey } from '@/utils/shared/monthKey';

type Props = {
  habit: Habit;
};

export default function HabitMonthCalendar({ habit }: Props) {
  const { t, i18n } = useTranslation();
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const borderColor = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');
  const toggleLogForDate = useHabitsStore((s) => s.toggleLogForDate);

  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';
  const todayKey = new Date().toISOString().slice(0, 10);
  const creationKey = habit.createdAt.slice(0, 10);
  const minMonthKey = getMonthKey(new Date(habit.createdAt));
  const maxMonthKey = getMonthKey(new Date());

  const [monthDate, setMonthDate] = useState(() => new Date(habit.createdAt));
  const monthKey = getMonthKey(monthDate);

  const canGoBack = monthKey > minMonthKey;
  const canGoForward = monthKey < maxMonthKey;

  const weeks = getMonthCalendarWeeks(monthKey, todayKey);
  const weekdayLabels = getWeekdayNarrowLabels(locale);
  const loggedDates = new Set(habit.logs.map((l) => l.date.slice(0, 10)));

  return (
    <View>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y.previousMonth')}
          accessibilityState={{ disabled: !canGoBack }}
          hitSlop={12}
          disabled={!canGoBack}
          onPress={() => setMonthDate((d) => addMonths(d, -1))}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
            size={20}
            tintColor={canGoBack ? textMuted : borderColor}
          />
        </Pressable>
        <Text style={styles.monthLabel}>{formatMonthLabel(monthDate, locale)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y.nextMonth')}
          accessibilityState={{ disabled: !canGoForward }}
          hitSlop={12}
          disabled={!canGoForward}
          onPress={() => setMonthDate((d) => addMonths(d, 1))}>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={20}
            tintColor={canGoForward ? textMuted : borderColor}
          />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {weekdayLabels.map((label, i) => (
          <Text key={i} style={[styles.weekdayLabel, { color: textMuted }]}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            if (day.key === null) {
              return <View key={di} style={styles.dayBox} />;
            }
            const isDone = loggedDates.has(day.key);
            const isBeforeCreation = day.key < creationKey;
            const isDisabled = day.isFuture || isBeforeCreation;

            return (
              <Pressable
                key={di}
                disabled={isDisabled}
                onPress={() => toggleLogForDate(habit.id, day.key!)}
                style={[
                  styles.dayBox,
                  styles.dayBoxFilled,
                  {
                    backgroundColor: isDone ? tint : surfaceMuted,
                    borderColor: day.isToday ? tint : borderColor,
                    borderWidth: day.isToday ? 2 : 1,
                    opacity: isDisabled ? 0.35 : 1,
                  },
                ]}>
                <Text style={[styles.dayNumber, { color: isDone ? '#FFFFFF' : textMuted }]}>{day.dayNumber}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  monthLabel: { fontWeight: '700', textTransform: 'capitalize' },
  weekdayRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  weekRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  dayBox: { flex: 1, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayBoxFilled: {},
  dayNumber: { fontSize: 12, fontWeight: '700' },
});
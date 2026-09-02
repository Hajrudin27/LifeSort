import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHabitsStore } from '@/store/useHabitsStore';
import { Habit } from '@/types/life';
import { getCurrentWeekDays } from '@/utils/habit/habitWeek';

type Props = {
  habit: Habit;
};

export default function HabitWeekRow({ habit }: Props) {
  const { i18n } = useTranslation();
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const borderColor = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');
  const toggleLogForDate = useHabitsStore((s) => s.toggleLogForDate);

  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';
  const weekDays = getCurrentWeekDays(locale);
  const loggedDates = new Set(habit.logs.map((l) => l.date.slice(0, 10)));
  const creationKey = habit.createdAt.slice(0, 10);

  return (
    <View style={styles.row}>
      {weekDays.map((day) => {
        const isDone = loggedDates.has(day.key);
        const isBeforeCreation = day.key < creationKey;
        const isDisabled = day.isFuture || isBeforeCreation;

        return (
          <Pressable
            key={day.key}
            disabled={isDisabled}
            onPress={() => toggleLogForDate(habit.id, day.key)}
            style={[
              styles.dayBox,
              {
                backgroundColor: isDone ? tint : surfaceMuted,
                borderColor: day.isToday ? tint : borderColor,
                borderWidth: day.isToday ? 2 : 1,
                opacity: isDisabled ? 0.35 : 1,
              },
            ]}>
            <Text style={[styles.dayLabel, { color: isDone ? '#FFFFFF' : textMuted }]}>{day.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  dayBox: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayLabel: { fontSize: 12, fontWeight: '700' },
});
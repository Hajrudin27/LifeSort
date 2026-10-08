import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import HabitDayCell from '@/components/HabitDayCell';
import { GRID_BLEED } from '@/components/habitGrid';
import { weekdayText } from '@/features/habits/habitDisplay';
import type { Habit, IsoWeekday } from '@/types/life';
import { addDaysIso, startOfIsoWeek } from '@/utils/shared/localDate';

type Props = {
  habit: Habit;
  /** The device-local date, owned by the screen (`useToday`), so a long list does not arm a timer per row. */
  today: string;
};

const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The ISO week (Monday to Sunday) that contains today, one cell per real date. */
export default function HabitWeekRow({ habit, today }: Props) {
  const { t } = useTranslation();
  const monday = startOfIsoWeek(today);

  return (
    <View style={styles.row}>
      {WEEKDAYS.map((weekday) => (
        <HabitDayCell key={weekday} habit={habit} date={addDaysIso(monday, weekday - 1)} today={today} label={weekdayText(weekday, 'narrow', t)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: -GRID_BLEED },
});

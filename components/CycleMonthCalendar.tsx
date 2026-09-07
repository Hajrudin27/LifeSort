import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { CycleEntry } from '@/types/cycle';
import { getCycleDayType } from '@/utils/cycle/cycleCalendar';
import { FertileWindow } from '@/utils/cycle/cyclePredictions';
import { getMonthCalendarWeeks, getWeekdayNarrowLabels } from '@/utils/habit/habitMonth';
import { addMonths, formatMonthLabel, getMonthKey } from '@/utils/shared/monthKey';

type Props = {
  cycles: CycleEntry[];
  fertileWindow: FertileWindow | null;
  predictedNext: string | null;
};

export default function CycleMonthCalendar({ cycles, fertileWindow, predictedNext }: Props) {
  const { t, i18n } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const borderColor = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');

  const danger = cycleTints.period;
  const tint = cycleTints.fertile;
  const warning = cycleTints.ovulation;

  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';
  const todayKey = new Date().toISOString().slice(0, 10);

  const [monthDate, setMonthDate] = useState(() => new Date());
  const monthKey = getMonthKey(monthDate);

  const weeks = getMonthCalendarWeeks(monthKey, todayKey);
  const weekdayLabels = getWeekdayNarrowLabels(locale);

  const colorForType = (type: string) => {
    switch (type) {
      case 'period':
        return danger;
      case 'fertile':
        return tint;
      case 'ovulation':
        return warning;
      case 'predicted':
        return warning;
      default:
        return surfaceMuted;
    }
  };

  return (
    <View>
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y.previousMonth')}
          hitSlop={8}
          style={[styles.navButton, { backgroundColor: cycleTints.accentSoft }]}
          onPress={() => setMonthDate((d) => addMonths(d, -1))}>
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={16} tintColor={cycleTints.accent} />
        </Pressable>
        <Text style={styles.monthLabel}>{formatMonthLabel(monthDate, locale)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.a11y.nextMonth')}
          hitSlop={8}
          style={[styles.navButton, { backgroundColor: cycleTints.accentSoft }]}
          onPress={() => setMonthDate((d) => addMonths(d, 1))}>
          <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={cycleTints.accent} />
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
            if (day.key === null) return <View key={di} style={styles.dayBox} />;

            const type = getCycleDayType(day.key, cycles, fertileWindow, predictedNext);
            const isFilled = type !== 'normal';
            const bgColor = colorForType(type);

            return (
              <View key={di} style={styles.dayBox}>
                {isFilled && (
                  <View
                    style={[
                      styles.dayGlow,
                      { backgroundColor: bgColor, opacity: type === 'predicted' ? 0.18 : 0.28 },
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.dayInner,
                    {
                      backgroundColor: isFilled ? bgColor : surfaceMuted,
                      borderColor: day.isToday ? cycleTints.accent : 'transparent',
                      borderWidth: day.isToday ? 2.5 : 0,
                      opacity: type === 'predicted' ? 0.55 : 1,
                    },
                  ]}>
                  <Text style={[styles.dayNumber, { color: isFilled ? '#FFFFFF' : textMuted }]}>{day.dayNumber}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}

      <View style={[styles.legend, { borderTopColor: borderColor }]}>
        <LegendItem color={danger} label={t('cycle.legendPeriod')} />
        <LegendItem color={tint} label={t('cycle.legendFertile')} />
        <LegendItem color={warning} label={t('cycle.legendOvulation')} />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1 },
  navButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontWeight: '800', fontSize: 15, textTransform: 'capitalize' },
  weekdayRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700' },
  weekRow: { flexDirection: 'row', gap: 6, marginBottom: 7 },
  dayBox: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayGlow: { position: 'absolute', width: '100%', height: '100%', borderRadius: 12 },
  dayInner: { width: '86%', height: '86%', borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 12, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendLabel: { fontSize: 11, fontWeight: '600' },
});
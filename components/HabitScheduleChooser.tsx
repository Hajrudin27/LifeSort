import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import Chip from '@/components/Chip';
import { CELL_INSET, GRID_BLEED, MIN_TARGET } from '@/components/habitGrid';
import { Text, useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { parseWeeklyTarget, toggleDay, type ScheduleChoice, type ScheduleForm } from '@/features/habits/domain/habitInput';
import { weekdayText } from '@/features/habits/habitDisplay';
import { useAccentTints } from '@/hooks/useAccentTints';
import type { IsoWeekday } from '@/types/life';

type Props = {
  value: ScheduleForm;
  onChange: (next: ScheduleForm) => void;
  /** Explains when a changed schedule starts. Shown only while editing an existing habit. */
  effectiveNote?: string | null;
};

const CHOICES: ScheduleChoice[] = ['everyDay', 'selectedDays', 'weekly', 'open'];
const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
const TARGET = { minHeight: 44, justifyContent: 'center' as const };

/**
 * Every day / selected days / N times a week / no fixed schedule. There is no start-date picker:
 * a new habit counts from today. The chooser only collects input; `scheduleFromForm` decides
 * whether it is valid, and the parent keeps Save disabled until it is.
 */
export default function HabitScheduleChooser({ value, onChange, effectiveNote }: Props) {
  const { t } = useTranslation();
  const tint = useAccentTints().accent;
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');
  const textColor = useThemeColor({}, 'text');
  const danger = useThemeColor({}, 'danger');

  const weeklyTyped = value.weeklyText.trim().length > 0;
  const weeklyInvalid = value.choice === 'weekly' && weeklyTyped && parseWeeklyTarget(value.weeklyText) === null;

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('habits.a11y.scheduleChoices')} style={styles.group}>
      <Text style={sharedStyles.fieldLabel}>{t('habits.scheduleLabel')}</Text>
      <View style={sharedStyles.chipRow}>
        {CHOICES.map((choice) => (
          <Chip
            key={choice}
            label={t(`habits.schedule.${choice}`)}
            active={value.choice === choice}
            accessibilityRole="radio"
            accessibilityState={{ checked: value.choice === choice, selected: value.choice === choice }}
            style={TARGET}
            onPress={() => onChange({ ...value, choice })}
          />
        ))}
      </View>

      {value.choice === 'selectedDays' && (
        <>
          <View style={styles.dayRow}>
            {WEEKDAYS.map((day) => {
              const checked = value.days.includes(day);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityLabel={weekdayText(day, 'long', t)}
                  accessibilityState={{ checked }}
                  onPress={() => onChange({ ...value, days: toggleDay(value.days, day) })}
                  style={styles.dayTarget}>
                  <View style={[styles.dayChip, { backgroundColor: checked ? tint : surfaceMuted, borderColor: checked ? tint : border }]}>
                    <Text style={[styles.dayText, { color: checked ? '#FFFFFF' : textMuted }]}>{weekdayText(day, 'short', t)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {value.days.length === 0 && <Text style={[styles.hint, { color: danger }]}>{t('habits.schedule.pickDays')}</Text>}
        </>
      )}

      {value.choice === 'weekly' && (
        <>
          <TextInput
            style={[sharedStyles.input, { borderColor: weeklyInvalid ? danger : border, backgroundColor: surface, color: textColor }]}
            accessibilityLabel={t('habits.schedule.weeklyInput')}
            placeholder={t('habits.schedule.weeklyInput')}
            placeholderTextColor={border}
            keyboardType="number-pad"
            maxLength={1}
            value={value.weeklyText}
            onChangeText={(weeklyText) => onChange({ ...value, weeklyText })}
          />
          {weeklyInvalid && <Text style={[styles.hint, { color: danger }]}>{t('habits.schedule.weeklyInvalid')}</Text>}
        </>
      )}

      {effectiveNote ? <Text style={[styles.hint, { color: textMuted }]}>{effectiveNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  dayRow: { flexDirection: 'row', marginHorizontal: -GRID_BLEED },
  // The whole column is the tap area (habitGrid.ts); the visible gap is drawn inside it.
  dayTarget: { flex: 1, minHeight: MIN_TARGET, padding: CELL_INSET },
  dayChip: { flex: 1, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 12 },
});

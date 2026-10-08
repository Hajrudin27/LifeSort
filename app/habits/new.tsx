import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import HabitScheduleChooser from '@/components/HabitScheduleChooser';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { HabitError } from '@/features/habits/domain/habitCommands';
import { DEFAULT_SCHEDULE_FORM, scheduleFromForm, type ScheduleForm } from '@/features/habits/domain/habitInput';
import { useHabitsStore } from '@/store/useHabitsStore';
import type { HabitDirection } from '@/types/life';

const DIRECTIONS: HabitDirection[] = ['build', 'quit'];

export default function NewHabitScreen() {
  const { t } = useTranslation();
  const addHabit = useHabitsStore((s) => s.addHabit);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textColor = useThemeColor({}, 'text');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState<HabitDirection>('build');
  const [schedule, setSchedule] = useState<ScheduleForm>(DEFAULT_SCHEDULE_FORM);
  const [rejected, setRejected] = useState(false);

  // Invalid values never reach the store: Save stays disabled until the form is a valid habit.
  const parsedSchedule = scheduleFromForm(schedule);
  const canSave = title.trim().length > 0 && parsedSchedule !== null;

  const save = () => {
    if (!canSave || !parsedSchedule) return;
    try {
      addHabit({ title: title.trim(), direction, schedule: parsedSchedule });
      router.back();
    } catch (error) {
      if (!(error instanceof HabitError)) throw error;
      setRejected(true);
    }
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
          accessibilityLabel={t('habits.titlePlaceholder')}
          placeholder={t('habits.titlePlaceholder')}
          placeholderTextColor={borderColor}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={sharedStyles.fieldLabel}>{t('habits.directionLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {DIRECTIONS.map((d) => (
            <Chip
              key={d}
              label={t(`habits.direction.${d}`)}
              active={direction === d}
              accessibilityRole="radio"
              accessibilityState={{ checked: direction === d, selected: direction === d }}
              style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => setDirection(d)}
            />
          ))}
        </View>
        <Text style={{ color: textMuted, fontSize: 12 }}>{t(`habits.directionHelp.${direction}`)}</Text>

        <HabitScheduleChooser value={schedule} onChange={setSchedule} />
        {rejected && <Text style={{ color: danger, fontSize: 12 }}>{t('habits.invalid')}</Text>}
      </Card>

      <Button label={t('habits.save')} disabled={!canSave} onPress={save} />
    </View>
  );
}

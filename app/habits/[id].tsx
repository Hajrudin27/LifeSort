import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import HabitStreakCard from '@/components/HabitStreakCard';
import HabitMonthCalendar from '@/components/HabitMonthCalendar';
import HabitScheduleChooser from '@/components/HabitScheduleChooser';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { HabitError, scheduleChangeEffectiveFrom } from '@/features/habits/domain/habitCommands';
import { formFromSchedule, scheduleFromForm, schedulesEqual, type ScheduleForm } from '@/features/habits/domain/habitInput';
import { hasEntryOn, scheduleForDisplay } from '@/features/habits/domain/habitStatus';
import { dayAction, scheduleLines, shortDateText, todayText, weekFactsText } from '@/features/habits/habitDisplay';
import { useToday } from '@/hooks/useToday';
import { useHabitsStore } from '@/store/useHabitsStore';
import type { HabitDirection } from '@/types/life';

const DIRECTIONS: HabitDirection[] = ['build', 'quit'];

export default function HabitDetailScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const today = useToday();

  const habit = useHabitsStore((s) => s.habits.find((h) => h.id === id));
  const updateHabit = useHabitsStore((s) => s.updateHabit);
  const setHabitSchedule = useHabitsStore((s) => s.setHabitSchedule);
  const setHabitDateCompleted = useHabitsStore((s) => s.setHabitDateCompleted);
  const removeHabit = useHabitsStore((s) => s.removeHabit);

  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState<HabitDirection>('build');
  const [schedule, setSchedule] = useState<ScheduleForm>(() => formFromSchedule({ kind: 'open' }));
  const [showEdit, setShowEdit] = useState(false);
  const [rejected, setRejected] = useState(false);

  if (!habit) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('habits.emptyState')}</Text>
      </View>
    );
  }

  const current = scheduleForDisplay(habit, today);
  const directionLocked = habit.logs.length > 0;
  const nextSchedule = scheduleFromForm(schedule);
  const scheduleChanged = nextSchedule !== null && !schedulesEqual(nextSchedule, current);
  const canSave = title.trim().length > 0 && nextSchedule !== null;
  // The copy follows the real rule: a weekly schedule involved means the next Monday (or today, on a Monday).
  const effectiveNote = scheduleChanged
    ? scheduleChangeEffectiveFrom(current, nextSchedule, today) === today ? t('habits.schedule.effectiveToday') : t('habits.schedule.effectiveNextMonday')
    : null;

  const openEdit = () => {
    setTitle(habit.title);
    setDirection(habit.direction);
    setSchedule(formFromSchedule(current));
    setRejected(false);
    setShowEdit(true);
  };

  const save = () => {
    if (!canSave || !nextSchedule) return;
    try {
      updateHabit(habit.id, { title: title.trim(), ...(direction !== habit.direction ? { direction } : {}) });
      if (scheduleChanged) setHabitSchedule(habit.id, nextSchedule);
      setShowEdit(false);
    } catch (error) {
      if (!(error instanceof HabitError)) throw error;
      setRejected(true);
    }
  };

  const confirmDelete = () => {
    Alert.alert(t('habits.deleteConfirmTitle'), t('habits.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      {
        text: t('habits.delete'),
        style: 'destructive',
        onPress: () => {
          removeHabit(habit.id);
          router.back();
        },
      },
    ]);
  };

  const todayAction = dayAction(habit, today, today);
  const done = hasEntryOn(habit, today);
  const markLabel = done
    ? t(habit.direction === 'build' ? 'habits.mark.clearBuild' : 'habits.mark.clearQuit')
    : t(habit.direction === 'build' ? 'habits.mark.build' : 'habits.mark.quit');
  const toggleToday = () => {
    try {
      setHabitDateCompleted(habit.id, today, todayAction === 'mark');
    } catch (error) {
      if (!(error instanceof HabitError)) throw error;
    }
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: habit.title,
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={openEdit} style={styles.editButton}>
              <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={20} tintColor={textMuted} />
              <Text style={{ color: textMuted }}>{t('habits.edit')}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{t(`habits.direction.${habit.direction}`)}</Text>
        {scheduleLines(habit, today, t, i18n.language).map((line) => (
          <Text key={line} style={{ color: textMuted }}>{line}</Text>
        ))}
        <Text style={{ color: textMuted }}>{t('habits.startedLabel', { date: shortDateText(habit.startDate, i18n.language) })}</Text>
        <Text style={styles.todayText}>{todayText(habit, today, t, i18n.language)}</Text>
        <Text style={{ color: textMuted }}>{weekFactsText(habit, today, t, i18n.language)}</Text>
        <Button label={markLabel} variant={done ? 'secondary' : 'primary'} disabled={todayAction === 'none'} onPress={toggleToday} />
      </Card>

      <HabitStreakCard habit={habit} today={today} />

      <Card>
        <Text style={styles.historyTitle} accessibilityRole="header">{t('habits.historyTitle')}</Text>
        <Text style={[styles.historyHelp, { color: textMuted }]}>{t('habits.historyHelp')}</Text>
        <HabitMonthCalendar habit={habit} />
      </Card>

      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <Pressable accessible={false} style={styles.modalBackdrop} onPress={() => setShowEdit(false)}>
          <Pressable accessible={false} style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Card style={sharedStyles.card}>
                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
                  accessibilityLabel={t('habits.titlePlaceholder')}
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
                      disabled={directionLocked && d !== habit.direction}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: direction === d, selected: direction === d, disabled: directionLocked && d !== habit.direction }}
                      style={{ minHeight: 44, justifyContent: 'center', opacity: directionLocked && d !== habit.direction ? 0.4 : 1 }}
                      onPress={() => setDirection(d)}
                    />
                  ))}
                </View>
                <Text style={{ color: textMuted, fontSize: 12 }}>
                  {directionLocked ? t('habits.directionLocked') : t(`habits.directionHelp.${direction}`)}
                </Text>

                <HabitScheduleChooser value={schedule} onChange={setSchedule} effectiveNote={effectiveNote} />
                {rejected && <Text style={{ color: danger, fontSize: 12 }}>{t('habits.invalid')}</Text>}
              </Card>

              <View style={styles.modalActions}>
                <Button label={t('habits.save')} disabled={!canSave} onPress={save} />
                <Button label={t('habits.delete')} variant="danger" onPress={confirmDelete} />
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  summaryCard: { gap: 6 },
  summaryTitle: { fontSize: 18, fontWeight: '800' as const },
  todayText: { fontSize: 16, fontWeight: '700' as const, marginTop: 4 },
  historyTitle: { fontSize: 16, fontWeight: '700' as const },
  historyHelp: { fontSize: 12, marginBottom: 8 },
  editButton: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginRight: 8, minHeight: 44 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 12, maxHeight: '90%' as const },
  modalActions: { gap: 12, marginTop: 12 },
};

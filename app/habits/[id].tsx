import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import HabitMonthCalendar from '@/components/HabitMonthCalendar';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHabitsStore } from '@/store/useHabitsStore';
import { HabitDirection } from '@/types/life';
import { getCurrentStreak, getLoggedThisWeek } from '@/utils/habit/habitStreak';

const DIRECTIONS: HabitDirection[] = ['build', 'quit'];

export default function HabitDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const habit = useHabitsStore((s) => s.habits.find((h) => h.id === id));
  const updateHabit = useHabitsStore((s) => s.updateHabit);
  const removeHabit = useHabitsStore((s) => s.removeHabit);

  const [title, setTitle] = useState(habit?.title ?? '');
  const [direction, setDirection] = useState<HabitDirection>(habit?.direction ?? 'build');
  const [target, setTarget] = useState(habit?.targetPerWeek?.toString() ?? '');
  const [showEdit, setShowEdit] = useState(false);

  if (!habit) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('habits.emptyState')}</Text>
      </View>
    );
  }

  const canSave = title.trim().length > 0;
  const streak = getCurrentStreak(habit.logs);
  const weekCount = getLoggedThisWeek(habit.logs);

  const save = () => {
    updateHabit(habit.id, {
      title: title.trim(),
      direction,
      targetPerWeek: target.trim().length > 0 && !isNaN(parseInt(target)) ? parseInt(target) : undefined,
    });
    setShowEdit(false);
    router.back();
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

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: habit.title,
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={() => setShowEdit(true)} style={styles.editButton}>
              <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={20} tintColor={textMuted} />
              <Text style={{ color: textMuted }}>{t('habits.edit')}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.streakCard}>
        <Text style={styles.streakNumber}>{streak}</Text>
        <Text style={{ color: textMuted }}>{t('habits.streakLabel', { count: streak })}</Text>
        {habit.targetPerWeek && (
          <Text style={[styles.weekText, { color: textMuted }]}>
            {t('habits.weekLabel', { count: weekCount, target: habit.targetPerWeek })}
          </Text>
        )}
      </Card>

      <Card>
        <HabitMonthCalendar habit={habit} />
      </Card>

      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <Pressable accessible={false} style={styles.modalBackdrop} onPress={() => setShowEdit(false)}>
          <Pressable accessible={false} style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <Card style={sharedStyles.card}>
              <TextInput
                style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                value={title}
                onChangeText={setTitle}
              />

              <Text style={sharedStyles.fieldLabel}>{t('habits.directionLabel')}</Text>
              <View style={sharedStyles.chipRow}>
                {DIRECTIONS.map((d) => (
                  <Chip key={d} label={t(`habits.direction.${d}`)} active={direction === d} onPress={() => setDirection(d)} />
                ))}
              </View>

              <TextInput
                style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                placeholder={t('habits.targetLabel')}
                placeholderTextColor={borderColor}
                keyboardType="number-pad"
                value={target}
                onChangeText={setTarget}
              />
            </Card>

            <Button label={t('habits.save')} disabled={!canSave} onPress={save} />
            <Button label={t('habits.delete')} variant="danger" onPress={confirmDelete} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  streakCard: { alignItems: 'center' as const, gap: 4 },
  streakNumber: { fontSize: 40, fontWeight: '800' as const },
  weekText: { fontSize: 13 },
  editButton: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginRight: 8 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 12 },
};
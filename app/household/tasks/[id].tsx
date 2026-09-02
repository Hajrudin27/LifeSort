import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { TaskFrequency } from '@/types/household';

const FREQUENCIES: TaskFrequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export default function HouseholdTaskDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const task = useHouseholdStore((s) => s.tasks.find((t) => t.id === id));
  const updateTask = useHouseholdStore((s) => s.updateTask);
  const markTaskDone = useHouseholdStore((s) => s.markTaskDone);
  const removeTask = useHouseholdStore((s) => s.removeTask);

  const [title, setTitle] = useState(task?.title ?? '');
  const [frequency, setFrequency] = useState<TaskFrequency>(task?.frequency ?? 'monthly');

  if (!task) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('household.emptyTasks')}</Text>
      </View>
    );
  }

  const canSave = title.trim().length > 0;

  const save = () => {
    updateTask(task.id, { title: title.trim(), frequency });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t('household.deleteConfirmTitle'), t('household.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      {
        text: t('household.delete'),
        style: 'destructive',
        onPress: () => {
          removeTask(task.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: task.title }} />

      <Card style={styles.statusCard}>
        <Text style={{ color: textMuted }}>
          {task.lastDone ? t('household.lastDone', { date: task.lastDone }) : t('household.neverDone')}
        </Text>
      </Card>

      <Button label={t('household.markDone')} variant="secondary" onPress={() => markTaskDone(task.id)} />

      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={sharedStyles.fieldLabel}>{t('household.frequencyLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {FREQUENCIES.map((f) => (
            <Chip key={f} label={t(`household.frequency.${f}`)} active={frequency === f} onPress={() => setFrequency(f)} />
          ))}
        </View>
      </Card>

      <Button label={t('household.save')} disabled={!canSave} onPress={save} />
      <Button label={t('household.delete')} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = {
  statusCard: { alignItems: 'center' as const },
};
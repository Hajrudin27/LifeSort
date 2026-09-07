import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useTodoStore } from '@/store/useTodoStore';
import { TodoImportance } from '@/types/life';
import { todayIso } from '@/utils/shared/localDate';

const IMPORTANCE_LEVELS: TodoImportance[] = ['low', 'medium', 'high'];

export default function TodoDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');

  const todo = useTodoStore((s) => s.todos.find((t) => t.id === id));
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);

  const [title, setTitle] = useState(todo?.title ?? '');
  const [description, setDescription] = useState(todo?.description ?? '');
  const [importance, setImportance] = useState<TodoImportance>(todo?.importance ?? 'medium');
  const [dueDate, setDueDate] = useState(todo?.dueDate ?? '');
  const [showDuePicker, setShowDuePicker] = useState(!!todo?.dueDate);

  if (!todo) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('todos.emptyState')}</Text>
      </View>
    );
  }

  const canSave = title.trim().length > 0;

  const save = () => {
    updateTodo(todo.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      importance,
      dueDate: showDuePicker && dueDate ? dueDate : undefined,
    });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t('todos.deleteConfirmTitle'), t('todos.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      {
        text: t('todos.delete'),
        style: 'destructive',
        onPress: () => {
          removeTodo(todo.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: todo.title }} />

      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('todos.titlePlaceholder')}
          placeholderTextColor={borderColor}
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('todos.descriptionPlaceholder')}
          placeholderTextColor={borderColor}
          value={description}
          onChangeText={setDescription}
        />

        <Text style={sharedStyles.fieldLabel}>{t('todos.importanceLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {IMPORTANCE_LEVELS.map((level) => (
            <Chip key={level} label={t(`todos.importance.${level}`)} active={importance === level} onPress={() => setImportance(level)} />
          ))}
        </View>

        {showDuePicker ? (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('todos.dueDateLabel')}</Text>
            <DatePickerField value={dueDate || todayIso()} onChange={setDueDate} />
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowDuePicker(true)}>
            <Text style={[styles.addLink, { color: textMuted }]}>+ {t('todos.dueDateLabel')}</Text>
          </Pressable>
        )}

        <Button
          label={todo.completed ? t('todos.markActive') : t('todos.markComplete')}
          variant="secondary"
          onPress={() => toggleTodo(todo.id)}
        />
      </Card>

      <Button label={t('todos.save')} disabled={!canSave} onPress={save} />
      <Button label={t('todos.delete')} variant="danger" onPress={confirmDelete} />
    </View>
  );
}

const styles = {
  addLink: { fontSize: 13 },
};
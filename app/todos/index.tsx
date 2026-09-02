import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHomeBackTitle } from '@/hooks/useHomeBackTitle';
import { useTodoStore } from '@/store/useTodoStore';
import { daysUntil } from '@/utils/shared/dateDays';

export default function TodosScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const borderColor = useThemeColor({}, 'border');
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const warning = useThemeColor({}, 'warning');

  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);

  const [showCompleted, setShowCompleted] = useState(false);

  const visibleTodos = (showCompleted ? todos : todos.filter((item) => !item.completed))
    .slice()
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

  return (
    <View style={sharedStyles.formContainer}>
      <View style={sharedStyles.chipRow}>
        <Chip label={t('todos.activeLabel')} active={!showCompleted} onPress={() => setShowCompleted(false)} />
        <Chip label={t('todos.showCompleted')} active={showCompleted} onPress={() => setShowCompleted(true)} />
      </View>

      <FlatList
        data={visibleTodos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('todos.emptyState')}</Text>
          </Card>
        }
        renderItem={({ item }) => {
          const days = item.dueDate ? daysUntil(item.dueDate) : null;
          const dueColor = days !== null && days < 0 ? danger : days !== null && days === 0 ? warning : textMuted;
          const dueLabel =
            days === null ? null : days < 0 ? t('todos.overdue') : days === 0 ? t('todos.dueToday') : t('todos.dueIn', { days });

          return (
            <Card style={sharedStyles.rowBetween}>
              <Pressable onPress={() => toggleTodo(item.id)}>
                <SymbolView
                  name={{
                    ios: item.completed ? 'checkmark.circle.fill' : 'circle',
                    android: item.completed ? 'check_circle' : 'radio_button_unchecked',
                    web: item.completed ? 'check_circle' : 'radio_button_unchecked',
                  }}
                  tintColor={item.completed ? tintColor : borderColor}
                  size={22}
                />
              </Pressable>

              <Pressable style={styles.titleWrap} onPress={() => router.push(`/todos/${item.id}`)}>
                <Text style={[styles.title, item.completed && { color: textMuted, textDecorationLine: 'line-through' }]}>
                  {item.title}
                </Text>
                {dueLabel && <Text style={[styles.meta, { color: dueColor }]}>{dueLabel}</Text>}
              </Pressable>
            </Card>
          );
        }}
      />

      <Button label={t('todos.addButton')} onPress={() => router.push('/todos/new')} />
    </View>
  );
}

const styles = {
  titleWrap: { flex: 1, marginLeft: 10 },
  title: { fontWeight: '700' as const },
  meta: { fontSize: 13, marginTop: 2 },
};
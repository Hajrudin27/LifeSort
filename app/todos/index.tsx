import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import Card from '@/components/Card';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import SwipeableRow from '@/components/SwipeableRow';
import { Text, useThemeColor } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useBrandTints } from '@/hooks/useBrandTints';
import { useHomeBackTitle } from '@/hooks/useHomeBackTitle';
import { useToastStore } from '@/store/useToastStore';
import { useTodoStore } from '@/store/useTodoStore';
import { TodoImportance, TodoItem } from '@/types/life';
import { daysUntil } from '@/utils/shared/dateDays';
import { addTodoToCalendar } from '@/utils/todo/calendarSync';

type FilterKey = 'active' | 'today' | 'upcoming' | 'overdue' | 'completed';


function getDueState(todo: TodoItem) {
  if (!todo.dueDate) return null;
  return daysUntil(todo.dueDate);
}

export default function TodosScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const borderColor = useThemeColor({}, 'border');
  const backgroundColor = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const accentTints = useAccentTints();
  const brand = useBrandTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const warning = useThemeColor({}, 'warning');
  const success = useThemeColor({}, 'success');
  const showToast = useToastStore((s) => s.show);

  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const removeTodo = useTodoStore((s) => s.removeTodo);

  const [filter, setFilter] = useState<FilterKey>('active');
  const [calendarLoadingId, setCalendarLoadingId] = useState<string | null>(null);

  const activeTodos = todos.filter((item) => !item.completed);
  const todayTodos = activeTodos.filter((item) => getDueState(item) === 0);
  const upcomingTodos = activeTodos.filter((item) => {
    const days = getDueState(item);
    return days !== null && days > 0;
  });
  const overdueTodos = activeTodos.filter((item) => {
    const days = getDueState(item);
    return days !== null && days < 0;
  });
  const completedTodos = todos.filter((item) => item.completed);
  const highPriorityTodos = activeTodos.filter((item) => item.importance === 'high');

  const filters = [
    { key: 'active', label: t('todos.activeLabel'), count: activeTodos.length },
    { key: 'today', label: t('todos.todayFilter'), count: todayTodos.length },
    { key: 'upcoming', label: t('todos.upcomingFilter'), count: upcomingTodos.length },
    { key: 'overdue', label: t('todos.overdueFilter'), count: overdueTodos.length },
    { key: 'completed', label: t('todos.completedFilter'), count: completedTodos.length },
  ] as const;

  const visibleTodos = useMemo(() => {
    const source =
      filter === 'today'
        ? todayTodos
        : filter === 'upcoming'
          ? upcomingTodos
          : filter === 'overdue'
            ? overdueTodos
            : filter === 'completed'
              ? completedTodos
              : activeTodos;

    return source.slice().sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.importance !== b.importance) return importanceRank(b.importance) - importanceRank(a.importance);
      if (!a.dueDate && !b.dueDate) return b.createdAt.localeCompare(a.createdAt);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }, [activeTodos, completedTodos, filter, overdueTodos, todayTodos, upcomingTodos]);

  const confirmDelete = (todo: TodoItem) => {
    Alert.alert(t('todos.deleteConfirmTitle'), t('todos.deleteConfirmMessage'), [
      { text: t('todos.cancel'), style: 'cancel' },
      { text: t('todos.delete'), style: 'destructive', onPress: () => removeTodo(todo.id) },
    ]);
  };

  const handleAddToCalendar = async (todo: TodoItem) => {
    setCalendarLoadingId(todo.id);
    const result = await addTodoToCalendar(todo);
    setCalendarLoadingId(null);

    if (result.ok) {
      showToast(t('todos.calendarAddedToast'));
      return;
    }

    if (result.reason === 'permission-denied') {
      showToast(t('todos.calendarPermissionToast'));
    } else if (result.reason === 'missing-date') {
      showToast(t('todos.calendarMissingDateToast'));
    } else {
      showToast(t('todos.calendarUnavailableToast'));
    }
  };

  const renderTodo = ({ item }: { item: TodoItem }) => {
    const days = getDueState(item);
    const isOverdue = days !== null && days < 0;
    const dueColor = isOverdue ? danger : days === 0 ? warning : textMuted;
    const dueLabel =
      days === null
        ? t('todos.noDueDate')
        : days < 0
          ? t('todos.overdue')
          : days === 0
            ? t('todos.dueToday')
            : t('todos.dueIn', { days });
    const priorityTone = importanceColor(item.importance, danger, warning, success);
    const showCalendarAction = !!item.dueDate && !item.completed;

    return (
      <SwipeableRow onDelete={() => confirmDelete(item)}>
        <Card style={[styles.todoCard, { borderColor: isOverdue ? danger : borderColor, backgroundColor: surface }]}>
          <Pressable style={styles.checkButton} onPress={() => toggleTodo(item.id)}>
            <SymbolView
              name={{
                ios: item.completed ? 'checkmark.circle.fill' : 'circle',
                android: item.completed ? 'check_circle' : 'radio_button_unchecked',
                web: item.completed ? 'check_circle' : 'radio_button_unchecked',
              }}
              tintColor={item.completed ? tintColor : borderColor}
              size={25}
            />
          </Pressable>

          <Pressable style={styles.todoTextGroup} onPress={() => router.push(`/todos/${item.id}`)}>
            <View style={styles.todoTopLine}>
              <Text style={[styles.todoTitle, item.completed && { color: textMuted, textDecorationLine: 'line-through' }]} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={[styles.priorityDot, { backgroundColor: priorityTone }]} />
            </View>

            {item.description ? (
              <Text style={[styles.todoDescription, { color: textMuted }]} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}

            <View style={styles.todoMetaRow}>
              <View style={[styles.metaPill, { backgroundColor: surfaceMuted }]}>
                <SymbolView name={{ ios: 'calendar', android: 'event', web: 'event' }} tintColor={dueColor} size={13} />
                <Text style={[styles.metaPillText, { color: dueColor }]}>{dueLabel}</Text>
              </View>
              <View style={[styles.metaPill, { backgroundColor: priorityTone + '1F' }]}>
                <Text style={[styles.metaPillText, { color: priorityTone }]}>{t(`todos.importance.${item.importance}`)}</Text>
              </View>
              {showCalendarAction && (
                <Pressable
                  style={[styles.calendarButton, { backgroundColor: accentTints.accentSoft }]}
                  disabled={calendarLoadingId === item.id}
                  onPress={() => handleAddToCalendar(item)}
                >
                  <SymbolView name={{ ios: 'calendar.badge.plus', android: 'event', web: 'event' }} size={13} tintColor={tintColor} />
                  <Text style={[styles.calendarButtonText, { color: tintColor }]}>
                    {calendarLoadingId === item.id ? t('todos.calendarAdding') : t('todos.calendarAction')}
                  </Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </Card>
      </SwipeableRow>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor }]}>
      <FlatList
        data={visibleTodos}
        keyExtractor={(item) => item.id}
        renderItem={renderTodo}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Card style={[styles.hero, { backgroundColor: brand.ink, overflow: 'hidden' }]}>
              <View style={[styles.heroRoseGlow, { backgroundColor: brand.glowPrimary }]} />
              <View style={[styles.heroAmberGlow, { backgroundColor: brand.glowSecondary }]} />
              <View style={styles.heroTopRow}>
                <View style={styles.heroIcon}>
                  <SymbolView name={{ ios: 'checklist', android: 'checklist', web: 'checklist' }} size={22} tintColor={brand.onBrand} />
                </View>
                <Pressable style={styles.heroAddButton} onPress={() => router.push('/todos/new')}>
                  <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={17} tintColor={brand.onBrand} />
                </Pressable>
              </View>
              <Text style={[styles.heroKicker, { color: brand.kickerOnBrand }]}>{t('todos.overviewKicker')}</Text>
              <Text style={[styles.heroTitle, { color: brand.onBrand }]}>{t('todos.overviewTitle')}</Text>
              <Text style={[styles.heroSubtitle, { color: brand.onBrand }]}>
                {overdueTodos.length > 0
                  ? t('todos.overviewOverdueSubtitle', { count: overdueTodos.length })
                  : todayTodos.length > 0
                    ? t('todos.overviewTodaySubtitle', { count: todayTodos.length })
                    : t('todos.overviewCalmSubtitle')}
              </Text>
            </Card>

            <View style={[styles.focusStrip, { backgroundColor: surface, borderColor }]}>
              <SummaryItem color={brand.glowSecondary} label={t('todos.todayFilter')} value={todayTodos.length} />
              <View style={[styles.focusDivider, { backgroundColor: borderColor }]} />
              <SummaryItem color={danger} label={t('todos.overdueFilter')} value={overdueTodos.length} />
              <View style={[styles.focusDivider, { backgroundColor: borderColor }]} />
              <SummaryItem color={brand.glowPrimary} label={t('todos.highPriorityShort')} value={highPriorityTodos.length} />
            </View>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>{t('todos.filterEyebrow')}</Text>
                <Text style={styles.sectionTitle}>{t('todos.tasksTitle')}</Text>
              </View>
              <Text style={[styles.sectionMeta, { color: textMuted }]}>{t('todos.openTasksCount', { count: activeTodos.length })}</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {filters.map((item) => (
                <Chip
                  key={item.key}
                  label={`${item.label} ${item.count}`}
                  active={filter === item.key}
                  onPress={() => setFilter(item.key)}
                />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={{ ios: 'checklist', android: 'checklist', web: 'checklist' }}
            title={filter === 'active' ? t('todos.emptyState') : t('todos.emptyFilterState')}
            subtitle={t('todos.emptyFilterSubtitle')}
            actionLabel={t('todos.addButton')}
            onAction={() => router.push('/todos/new')}
          />
        }
      />
    </View>
  );
}

function SummaryItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.summaryItem}>
      <View style={[styles.summaryDot, { backgroundColor: color }]} />
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function importanceRank(importance: TodoImportance) {
  return importance === 'high' ? 3 : importance === 'medium' ? 2 : 1;
}

function importanceColor(importance: TodoImportance, danger: string, warning: string, success: string) {
  if (importance === 'high') return danger;
  if (importance === 'medium') return warning;
  return success;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 42 },
  header: { gap: 12, marginBottom: 2 },
  hero: { borderRadius: 24, gap: 7, padding: 18, position: 'relative' },
  heroRoseGlow: { position: 'absolute', width: 170, height: 170, borderRadius: 85, top: -82, right: -56, opacity: 0.25 },
  heroAmberGlow: { position: 'absolute', width: 118, height: 118, borderRadius: 59, bottom: -48, left: -34, opacity: 0.18 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroAddButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    backgroundColor: 'transparent',
  },
  heroTitle: { fontSize: 24, fontWeight: '800', backgroundColor: 'transparent' },
  heroSubtitle: { fontSize: 13, lineHeight: 18, opacity: 0.85, backgroundColor: 'transparent' },
  focusStrip: {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
  summaryDot: { width: 6, height: 6, borderRadius: 3 },
  summaryValue: { fontSize: 18, fontWeight: '800' },
  summaryLabel: { fontSize: 11, fontWeight: '700', opacity: 0.62 },
  focusDivider: { width: 1, height: 34, opacity: 0.7 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  sectionEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.62 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  sectionMeta: { fontSize: 12, fontWeight: '800' },
  filterRow: { gap: 8, paddingRight: 12 },
  todoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, marginBottom: 6, padding: 14 },
  checkButton: { paddingTop: 2 },
  todoTextGroup: { flex: 1, gap: 7 },
  todoTopLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  todoTitle: { flex: 1, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  todoDescription: { fontSize: 12, lineHeight: 17 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  todoMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  metaPillText: { fontSize: 11, fontWeight: '800' },
  calendarButton: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  calendarButtonText: { fontSize: 11, fontWeight: '800' },
});

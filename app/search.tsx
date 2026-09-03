import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput } from 'react-native';

import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';

type ResultKind = 'todo' | 'expense' | 'warranty' | 'habit' | 'goal';
type IconName = { ios: string; android: string; web: string };

type SearchResult = {
  id: string;
  kind: ResultKind;
  title: string;
};

const KIND_ICON: Record<ResultKind, IconName> = {
  todo: { ios: 'checklist', android: 'checklist', web: 'checklist' },
  expense: { ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' },
  warranty: { ios: 'shield.fill', android: 'shield', web: 'shield' },
  habit: { ios: 'repeat', android: 'repeat', web: 'repeat' },
  goal: { ios: 'flag.fill', android: 'flag', web: 'flag' },
};

export default function SearchScreen() {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');

  const [query, setQuery] = useState('');

  const todos = useTodoStore((s) => s.todos);
  const expenses = useExpensesStore((s) => s.expenses);
  const warranties = useWarrantiesStore((s) => s.warranties);
  const habits = useHabitsStore((s) => s.habits);
  const goals = useLifeGoalsStore((s) => s.goals);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const out: SearchResult[] = [];
    todos.forEach((item) => {
      if (item.title.toLowerCase().includes(q)) out.push({ id: item.id, kind: 'todo', title: item.title });
    });
    expenses.forEach((item) => {
      if (item.name.toLowerCase().includes(q)) out.push({ id: item.id, kind: 'expense', title: item.name });
    });
    warranties.forEach((item) => {
      if (item.name.toLowerCase().includes(q)) out.push({ id: item.id, kind: 'warranty', title: item.name });
    });
    habits.forEach((item) => {
      if (item.title.toLowerCase().includes(q)) out.push({ id: item.id, kind: 'habit', title: item.title });
    });
    goals.forEach((item) => {
      if (item.title.toLowerCase().includes(q)) out.push({ id: item.id, kind: 'goal', title: item.title });
    });
    return out;
  }, [query, todos, expenses, warranties, habits, goals]);

  const navigateTo = (item: SearchResult) => {
    switch (item.kind) {
      case 'todo':
        router.push(`/todos/${item.id}`);
        break;
      case 'expense':
        router.push(`/expenses/edit/${item.id}`);
        break;
      case 'warranty':
        router.push(`/warranties/${item.id}`);
        break;
      case 'habit':
        router.push(`/habits/${item.id}`);
        break;
      case 'goal':
        router.push(`/life-goals/${item.id}`);
        break;
    }
  };

  return (
    <View style={sharedStyles.formContainer}>
      <View style={[styles.searchBar, { borderColor, backgroundColor: surface }]}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={16} tintColor={textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={borderColor}
          style={styles.searchInput}
          autoFocus
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        contentContainerStyle={sharedStyles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length < 2 ? (
            <Text style={{ color: textMuted, textAlign: 'center', marginTop: 24 }}>{t('search.hint')}</Text>
          ) : (
            <EmptyState icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} title={t('search.noResults')} />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigateTo(item)}>
            <Card style={styles.resultRow}>
              <View style={[styles.iconCircle, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={KIND_ICON[item.kind] as any} size={16} tintColor={accentTints.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.resultTitle}>{item.title}</Text>
                <Text style={[styles.resultSubtitle, { color: textMuted }]}>{t(`search.kinds.${item.kind}`)}</Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = {
  searchBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15 },
  resultRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const },
  resultTitle: { fontWeight: '700' as const },
  resultSubtitle: { fontSize: 12, marginTop: 1 },
};
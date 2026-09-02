import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import HabitWeekRow from '@/components/HabitWeekRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHabitsStore } from '@/store/useHabitsStore';
import { getCurrentStreak } from '@/utils/habit/habitStreak';
import { Pressable } from 'react-native';

export default function HabitsScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const habits = useHabitsStore((s) => s.habits);

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={habits}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('habits.emptyState')}</Text>
          </Card>
        }
        renderItem={({ item }) => {
          const streak = getCurrentStreak(item.logs);
          return (
            <Card style={styles.card}>
              <Pressable onPress={() => router.push(`/habits/${item.id}`)}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={[styles.meta, { color: textMuted }]}>{t('habits.streakLabel', { count: streak })}</Text>
              </Pressable>
              <HabitWeekRow habit={item} />
            </Card>
          );
        }}
      />

      <Button label={t('habits.addButton')} onPress={() => router.push('/habits/new')} />
    </View>
  );
}

const styles = {
  card: { gap: 10 },
  title: { fontWeight: '700' as const, fontSize: 16 },
  meta: { fontSize: 13, marginTop: 2 },
};
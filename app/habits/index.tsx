import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import HabitPeriodSummaryCard from '@/components/HabitPeriodSummaryCard';
import HabitWeekRow from '@/components/HabitWeekRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { scheduleLines, todayText } from '@/features/habits/habitDisplay';
import { useToday } from '@/hooks/useToday';
import { useHabitsStore } from '@/store/useHabitsStore';

export default function HabitsScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const habits = useHabitsStore((s) => s.habits);
  const today = useToday();

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={habits}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListHeaderComponent={habits.length > 0 ? <HabitPeriodSummaryCard habits={habits} today={today} /> : null}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('habits.emptyState')}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Pressable accessibilityRole="button" style={styles.header} onPress={() => router.push(`/habits/${item.id}`)}>
              <Text style={styles.title}>{item.title}</Text>
              {scheduleLines(item, today, t, i18n.language).map((line) => (
                <Text key={line} style={[styles.meta, { color: textMuted }]}>{line}</Text>
              ))}
              <Text style={[styles.meta, { color: textMuted }]}>{todayText(item, today, t, i18n.language)}</Text>
            </Pressable>
            <HabitWeekRow habit={item} today={today} />
          </Card>
        )}
      />

      <Button label={t('habits.addButton')} onPress={() => router.push('/habits/new')} />
    </View>
  );
}

const styles = {
  card: { gap: 10 },
  header: { minHeight: 44 },
  title: { fontWeight: '700' as const, fontSize: 16 },
  meta: { fontSize: 13, marginTop: 2 },
};

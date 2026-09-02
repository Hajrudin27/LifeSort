import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useLifeModuleTints } from '@/hooks/useLifeModuleTints';
import { useCareerStore } from '@/store/useCareerStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';
import { getCurrentStreak } from '@/utils/habit/habitStreak';
import { daysUntilDue } from '@/utils/household/householdTaskSchedule';

export default function LifeScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const tints = useLifeModuleTints();
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');

  const todos = useTodoStore((s) => s.todos);
  const activeTodos = todos.filter((item) => !item.completed).length;

  const lifeGoals = useLifeGoalsStore((s) => s.goals);
  const activeGoals = lifeGoals.filter((g) => {
    const total = g.subGoals.length;
    const done = g.subGoals.filter((sg) => sg.completed).length;
    return !(total > 0 && done === total);
  }).length;

  const habits = useHabitsStore((s) => s.habits);
  const topStreak = habits
    .map((h) => getCurrentStreak(h.logs))
    .sort((a, b) => b - a)[0] ?? 0;

  const householdTasks = useHouseholdStore((s) => s.tasks);
  const dueHouseholdCount = householdTasks.filter((ht) => daysUntilDue(ht.lastDone, ht.frequency) <= 0).length;

  const applications = useCareerStore((s) => s.applications);
  const interviewCount = applications.filter((a) => a.status === 'interview').length;
  const appliedCount = applications.filter((a) => a.status === 'applied').length;

  const modules = [
    {
      key: 'todos',
      label: t('life.todosLabel'),
      desc: t('life.todosDesc'),
      icon: { ios: 'checklist', android: 'checklist', web: 'checklist' },
      count: activeTodos,
      route: '/todos' as const,
      color: tints.todos,
    },
    {
      key: 'lifeGoals',
      label: t('life.lifeGoalsLabel'),
      desc: t('life.lifeGoalsDesc'),
      icon: { ios: 'flag.fill', android: 'flag', web: 'flag' },
      count: activeGoals,
      route: '/life-goals' as const,
      color: tints.lifeGoals,
    },
    {
      key: 'habits',
      label: t('life.habitsLabel'),
      desc: t('life.habitsDesc'),
      icon: { ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' },
      count: habits.length,
      badge: topStreak > 0 ? `🔥${topStreak}` : undefined,
      route: '/habits' as const,
      color: tints.habits,
    },
    {
      key: 'household',
      label: t('life.householdLabel'),
      desc: t('life.householdDesc'),
      icon: { ios: 'house.fill', android: 'home', web: 'home' },
      count: dueHouseholdCount,
      route: '/household' as const,
      color: tints.household,
    },
    {
      key: 'career',
      label: t('life.careerLabel'),
      desc: t('life.careerDesc'),
      icon: { ios: 'briefcase.fill', android: 'work', web: 'work' },
      count: appliedCount,
      badge: interviewCount > 0 ? `🎤${interviewCount}` : undefined,
      route: '/career' as const,
      color: tints.career,
    },
  ];

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={styles.container}>
      <Card style={[styles.hero, { backgroundColor: tint, overflow: 'hidden' }]}>
        <View style={[styles.heroCircleLarge, { backgroundColor: '#FFFFFF', opacity: 0.08 }]} />
        <View style={[styles.heroCircleSmall, { backgroundColor: '#FFFFFF', opacity: 0.1 }]} />
        <Text style={styles.heroTitle}>{t('life.title')}</Text>
        <Text style={styles.heroSubtitle}>{t('life.heroSubtitle')}</Text>
      </Card>

      <View style={styles.grid}>
        {modules.map((m) => (
          <Pressable key={m.key} style={styles.gridCell} onPress={() => router.push(m.route)}>
            <Card style={[styles.moduleCard, { backgroundColor: m.color }]}>
              <View style={styles.moduleHeader}>
                <View style={[styles.iconCircle, { backgroundColor: tint }]}>
                  <SymbolView name={m.icon as any} size={16} tintColor="#FFFFFF" />
                </View>
                {m.badge ? (
                  <Text style={styles.moduleBadge}>{m.badge}</Text>
                ) : m.count > 0 ? (
                  <View style={[styles.moduleCount, { backgroundColor: tint }]}>
                    <Text style={styles.moduleCountText}>{m.count}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.moduleLabel}>{m.label}</Text>
              <Text style={[styles.moduleDesc, { color: textMuted }]}>{m.desc}</Text>
            </Card>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = {
  container: { padding: 16, gap: 14, paddingBottom: 48 },
  hero: { padding: 20, gap: 4, position: 'relative' as const },
  heroCircleLarge: { position: 'absolute' as const, width: 160, height: 160, borderRadius: 80, top: -50, right: -40 },
  heroCircleSmall: { position: 'absolute' as const, width: 80, height: 80, borderRadius: 40, bottom: -25, left: -15 },
  heroTitle: { fontSize: 26, fontWeight: '800' as const, color: '#FFFFFF' },
  heroSubtitle: { fontSize: 14, color: '#FFFFFF', opacity: 0.9, marginTop: 2 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 12 },
  gridCell: { width: '47%' as const },
  moduleCard: { gap: 6, minHeight: 108 },
  moduleHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const, backgroundColor: 'transparent' },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const },
  moduleCount: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 6 },
  moduleCountText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' as const },
  moduleBadge: { fontSize: 13, fontWeight: '700' as const, backgroundColor: 'transparent' },
  moduleLabel: { fontSize: 16, fontWeight: '800' as const, marginTop: 4 },
  moduleDesc: { fontSize: 12 },
};
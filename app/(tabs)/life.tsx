import { type Href, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import MetricCard from '@/components/MetricCard';
import QuickActionCard from '@/components/QuickActionCard';
import Screen from '@/components/Screen';
import SectionHeader from '@/components/SectionHeader';
import { Text, useThemeColor, View } from '@/components/Themed';
import type { ModuleId } from '@/core/modules/moduleRegistry';
import { useEnabledModuleIds } from '@/core/modules/useModuleEnabled';
import { useBrandTints } from '@/hooks/useBrandTints';
import { useLifeModuleTints } from '@/hooks/useLifeModuleTints';
import { useCareerStore } from '@/store/useCareerStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';
import { getCurrentStreak, getLoggedThisWeek } from '@/utils/habit/habitStreak';
import { daysUntilDue } from '@/utils/household/householdTaskSchedule';
import { daysUntil } from '@/utils/shared/dateDays';

type IconName = { ios: string; android: string; web: string };
type LifeModuleKey = 'todos' | 'lifeGoals' | 'habits' | 'household' | 'career';

type FocusCard = {
  icon: IconName;
  title: string;
  subtitle: string;
  route: Href;
  tone: string;
};

export default function LifeScreen() {
  const { t } = useTranslation();
  const tints = useLifeModuleTints();
  const backgroundColor = useThemeColor({}, 'background');
  const brand = useBrandTints();
  const borderColor = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');

  const todos = useTodoStore((s) => s.todos);
  const activeTodos = todos.filter((item) => !item.completed);
  const overdueTodos = activeTodos.filter((item) => item.dueDate && daysUntil(item.dueDate) < 0);
  const dueTodayTodos = activeTodos.filter((item) => item.dueDate && daysUntil(item.dueDate) === 0);
  const highPriorityTodos = activeTodos.filter((item) => item.importance === 'high');

  const lifeGoals = useLifeGoalsStore((s) => s.goals);
  const totalSubGoals = lifeGoals.reduce((sum, goal) => sum + goal.subGoals.length, 0);
  const completedSubGoals = lifeGoals.reduce(
    (sum, goal) => sum + goal.subGoals.filter((subGoal) => subGoal.completed).length,
    0,
  );
  const goalProgress = totalSubGoals > 0 ? completedSubGoals / totalSubGoals : 0;
  const activeGoals = lifeGoals.filter((goal) => {
    const total = goal.subGoals.length;
    const done = goal.subGoals.filter((subGoal) => subGoal.completed).length;
    return !(total > 0 && done === total);
  }).length;

  const habits = useHabitsStore((s) => s.habits);
  const topStreak = habits.map((habit) => getCurrentStreak(habit.logs)).sort((a, b) => b - a)[0] ?? 0;
  const habitLogsThisWeek = habits.reduce((sum, habit) => sum + getLoggedThisWeek(habit.logs), 0);

  const householdTasks = useHouseholdStore((s) => s.tasks);
  const dueHouseholdCount = householdTasks.filter((task) => daysUntilDue(task.lastDone, task.frequency) <= 0).length;

  const applications = useCareerStore((s) => s.applications);
  const interviewCount = applications.filter((application) => application.status === 'interview').length;
  const openApplications = applications.filter((application) => application.status !== 'rejected').length;

  const focusCard: FocusCard =
    overdueTodos.length > 0
      ? {
          icon: { ios: 'exclamationmark.circle.fill', android: 'priority_high', web: 'priority_high' },
          title: t('life.focusOverdueTitle'),
          subtitle: t('life.focusOverdueSubtitle', { count: overdueTodos.length }),
          route: '/todos',
          tone: brand.glowPrimary,
        }
      : dueTodayTodos.length > 0
        ? {
            icon: { ios: 'calendar.badge.exclamationmark', android: 'event_available', web: 'event_available' },
            title: t('life.focusTodayTitle'),
            subtitle: t('life.focusTodaySubtitle', { count: dueTodayTodos.length }),
            route: '/todos',
            tone: brand.glowSecondary,
          }
        : dueHouseholdCount > 0
          ? {
              icon: { ios: 'house.fill', android: 'home', web: 'home' },
              title: t('life.focusHouseholdTitle'),
              subtitle: t('life.focusHouseholdSubtitle', { count: dueHouseholdCount }),
              route: '/household/tasks',
              tone: '#2563EB',
            }
          : habits.length > 0 && topStreak === 0
            ? {
                icon: { ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' },
                title: t('life.focusHabitTitle'),
                subtitle: t('life.focusHabitSubtitle'),
                route: '/habits',
                tone: brand.glowPrimary,
              }
            : activeGoals > 0 && goalProgress < 1
              ? {
                  icon: { ios: 'flag.fill', android: 'flag', web: 'flag' },
                  title: t('life.focusGoalTitle'),
                  subtitle: t('life.focusGoalSubtitle', { progress: Math.round(goalProgress * 100) }),
                  route: '/life-goals',
                  tone: brand.glowSecondary,
                }
              : {
                  icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
                  title: t('life.focusDefaultTitle'),
                  subtitle: t('life.focusDefaultSubtitle'),
                  route: '/todos/new',
                  tone: '#16A34A',
                };

  const allModules: Array<{
    key: LifeModuleKey;
    icon: IconName;
    title: string;
    subtitle: string;
    value: string;
    helper: string;
    route: Href;
    tone: string;
  }> = [
    {
      key: 'todos',
      icon: { ios: 'checklist', android: 'checklist', web: 'checklist' },
      title: t('life.todosLabel'),
      subtitle: t('life.todosDesc'),
      value: String(activeTodos.length),
      helper: t('life.todosHelper', { count: highPriorityTodos.length }),
      route: '/todos',
      tone: brand.glowPrimary,
    },
    {
      key: 'lifeGoals',
      icon: { ios: 'flag.fill', android: 'flag', web: 'flag' },
      title: t('life.lifeGoalsLabel'),
      subtitle: t('life.lifeGoalsDesc'),
      value: `${Math.round(goalProgress * 100)}%`,
      helper: t('life.lifeGoalsHelper', { count: activeGoals }),
      route: '/life-goals',
      tone: brand.glowSecondary,
    },
    {
      key: 'habits',
      icon: { ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' },
      title: t('life.habitsLabel'),
      subtitle: t('life.habitsDesc'),
      value: String(topStreak),
      helper: t('life.habitsHelper', { count: habitLogsThisWeek }),
      route: '/habits',
      tone: '#16A34A',
    },
    {
      key: 'household',
      icon: { ios: 'house.fill', android: 'home', web: 'home' },
      title: t('life.householdLabel'),
      subtitle: t('life.householdDesc'),
      value: String(dueHouseholdCount),
      helper: t('life.householdHelper'),
      route: '/household',
      tone: '#2563EB',
    },
    {
      key: 'career',
      icon: { ios: 'briefcase.fill', android: 'work', web: 'work' },
      title: t('life.careerLabel'),
      subtitle: t('life.careerDesc'),
      value: String(openApplications),
      helper: t('life.careerHelper', { count: interviewCount }),
      route: '/career',
      tone: '#7C3AED',
    },
  ];

  // Hub'en viser kun de moduler brugeren har valgt til (APP-010). Fravalg
  // skjuler — det sletter ikke, og modulet kan slås til igen i Indstillinger.
  const enabled = useEnabledModuleIds();
  const moduleIdByKey: Record<LifeModuleKey, ModuleId> = {
    todos: 'tasks',
    lifeGoals: 'goals',
    habits: 'habits',
    household: 'home',
    career: 'career',
  };
  const modules = allModules.filter((module) => enabled.includes(moduleIdByKey[module.key]));

  return (
    <Screen contentContainerStyle={styles.content}>
      <Card style={[styles.hero, { backgroundColor: brand.ink }]}>
        <View style={[styles.heroGlow, styles.heroGlowRose, { backgroundColor: brand.glowPrimary }]} />
        <View style={[styles.heroGlow, styles.heroGlowAmber, { backgroundColor: brand.glowSecondary }]} />
        <View style={styles.heroTopRow}>
          <View style={styles.heroIcon}>
            <SymbolView
              name={{ ios: 'star.fill', android: 'star', web: 'star' }}
              size={18}
              tintColor="#FFFFFF"
            />
          </View>
          <Text style={styles.heroKicker}>{t('life.heroKicker')}</Text>
        </View>
        <Text style={styles.heroTitle}>{t('life.title')}</Text>
        <Text style={styles.heroSubtitle}>{t('life.heroSubtitle')}</Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>{t('life.openTasksLabel')}</Text>
            <Text style={styles.heroStatValue}>{activeTodos.length + dueHouseholdCount}</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>{t('life.progressLabel')}</Text>
            <Text style={styles.heroStatValue}>{Math.round(goalProgress * 100)}%</Text>
          </View>
        </View>
      </Card>

      <Card style={[styles.focusCard, { borderColor: `${focusCard.tone}33` }]}>
        <View style={[styles.focusIcon, { backgroundColor: `${focusCard.tone}18` }]}>
          <SymbolView name={focusCard.icon as any} size={20} tintColor={focusCard.tone} />
        </View>
        <View style={styles.focusText}>
          <Text style={[styles.focusEyebrow, { color: focusCard.tone }]}>{t('life.focusEyebrow')}</Text>
          <Text style={styles.focusTitle}>{focusCard.title}</Text>
          <Text style={[styles.focusSubtitle, { color: textMuted }]}>{focusCard.subtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('life.a11y.openFocus', { title: focusCard.title })}
          style={[styles.focusButton, { backgroundColor: focusCard.tone }]}
          onPress={() => router.push(focusCard.route)}>
          <SymbolView name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={17} tintColor="#FFFFFF" />
        </Pressable>
      </Card>

      <View style={styles.metricGrid}>
        <MetricCard
          icon={{ ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' }}
          label={t('life.topStreakLabel')}
          value={String(topStreak)}
          helper={t('life.topStreakHelper')}
          tone="#16A34A"
          onPress={() => router.push('/habits')}
          style={styles.metricItem}
        />
        <MetricCard
          icon={{ ios: 'briefcase.fill', android: 'work', web: 'work' }}
          label={t('life.careerMetricLabel')}
          value={String(interviewCount)}
          helper={t('life.careerMetricHelper')}
          tone="#7C3AED"
          onPress={() => router.push('/career/applications')}
          style={styles.metricItem}
        />
      </View>

      <SectionHeader
        eyebrow={t('life.modulesEyebrow')}
        title={t('life.modulesTitle')}
        subtitle={t('life.modulesSubtitle')}
      />

      <View style={styles.moduleList}>
        {modules.map((module) => (
          <Pressable accessibilityRole="button" key={module.key} onPress={() => router.push(module.route)}>
            <Card style={[styles.moduleCard, { borderColor: `${module.tone}33` }]}>
              <View style={[styles.moduleAccent, { backgroundColor: tints[module.key] }]} />
              <View style={[styles.moduleIcon, { backgroundColor: `${module.tone}18` }]}>
                <SymbolView name={module.icon as any} size={19} tintColor={module.tone} />
              </View>
              <View style={styles.moduleText}>
                <Text style={styles.moduleTitle}>{module.title}</Text>
                <Text style={[styles.moduleSubtitle, { color: textMuted }]} numberOfLines={2}>
                  {module.subtitle}
                </Text>
              </View>
              <View style={[styles.moduleValue, { backgroundColor: surfaceMuted, borderColor }]}>
                <Text style={styles.moduleValueText} numberOfLines={1}>{module.value}</Text>
                <Text style={[styles.moduleValueHelper, { color: textMuted }]} numberOfLines={1}>
                  {module.helper}
                </Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </View>

      <SectionHeader eyebrow={t('life.quickEyebrow')} title={t('life.quickTitle')} />

      <View style={styles.quickList}>
        <QuickActionCard
          icon={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
          title={t('life.quickTodoTitle')}
          subtitle={t('life.quickTodoSubtitle')}
          tone={brand.glowPrimary}
          onPress={() => router.push('/todos/new')}
        />
        <QuickActionCard
          icon={{ ios: 'flag.badge.ellipsis', android: 'outlined_flag', web: 'outlined_flag' }}
          title={t('life.quickGoalTitle')}
          subtitle={t('life.quickGoalSubtitle')}
          tone={brand.glowSecondary}
          onPress={() => router.push('/life-goals/new')}
        />
        <QuickActionCard
          icon={{ ios: 'house.badge.plus', android: 'add_home', web: 'add_home' }}
          title={t('life.quickHouseholdTitle')}
          subtitle={t('life.quickHouseholdSubtitle')}
          tone="#2563EB"
          onPress={() => router.push('/household/tasks/new')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 72,
  },
  hero: {
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
    overflow: 'hidden',
    padding: 20,
  },
  heroGlow: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    opacity: 0.2,
  },
  heroGlowRose: {
    right: -48,
    top: -54,
  },
  heroGlowAmber: {
    bottom: -70,
    left: -56,
  },
  heroTopRow: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 29,
    fontWeight: '900',
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    lineHeight: 18,
  },
  heroStats: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    flexDirection: 'row',
    marginTop: 4,
    padding: 14,
  },
  heroStat: {
    backgroundColor: 'transparent',
    flex: 1,
    gap: 3,
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  heroStatValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  heroDivider: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginHorizontal: 14,
    width: 1,
  },
  focusCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1.5,
  },
  focusIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  focusText: {
    backgroundColor: 'transparent',
    flex: 1,
    gap: 2,
  },
  focusEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  focusTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  focusSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  focusButton: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  metricItem: {
    flex: 1,
  },
  moduleList: {
    gap: 10,
  },
  moduleCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 104,
    overflow: 'hidden',
  },
  moduleAccent: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 5,
  },
  moduleIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  moduleText: {
    backgroundColor: 'transparent',
    flex: 1,
    gap: 3,
  },
  moduleTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  moduleSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  moduleValue: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    paddingHorizontal: 8,
    width: 74,
  },
  moduleValueText: {
    fontSize: 18,
    fontWeight: '900',
  },
  moduleValueHelper: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 1,
    textAlign: 'center',
  },
  quickList: {
    gap: 10,
  },
});

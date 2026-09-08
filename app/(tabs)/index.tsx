import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dimensions, NativeScrollEvent, NativeSyntheticEvent, Pressable, RefreshControl, ScrollView } from 'react-native';

import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { resolveHomeGridState, skeletonCardCount } from '@/core/modules/homeGridState';
import { previousMonthKey } from '@/core/modules/monthlyReview';
import { isMaskable, MASKED_VALUE, resolveCardDetail } from '@/core/modules/homePrivacy';
import { hiddenModuleIds, rankHomeSnapshots } from '@/core/modules/homeRanking';
import { useHomeSnapshots } from '@/core/modules/homeSnapshots';
import { getModule } from '@/core/modules/moduleRegistry';
import { HOME_SNAPSHOT_PROVIDERS } from '@/features/homeSnapshots';
import MetricCard from '@/components/MetricCard';
import MetricCardSkeleton from '@/components/MetricCardSkeleton';
import QuickActionCard from '@/components/QuickActionCard';
import Screen from '@/components/Screen';
import SectionHeader from '@/components/SectionHeader';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import Kicker from '@/components/Kicker';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useBrandTints } from '@/hooks/useBrandTints';
import { useFoodStore } from '@/store/useFoodStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useHomeLayoutStore } from '@/store/useHomeLayoutStore';
import { useReviewStore } from '@/store/useReviewStore';
import { useProfileStore } from '@/store/useProfileStore';
import { useTodoStore } from '@/store/useTodoStore';
import { useTripsStore } from '@/store/useTripsStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { getCurrentStreak, hasLoggedToday } from '@/utils/habit/habitStreak';
import { isDateInCurrentWeek } from '@/utils/habit/habitWeek';
import { daysUntilDue } from '@/utils/household/householdTaskSchedule';
import { daysUntil } from '@/utils/shared/dateDays';
import { getGreetingPeriod } from '@/utils/shared/greeting';
import { getMonthKey } from '@/utils/shared/monthKey';
import { toLocalIsoDate } from '@/utils/shared/localDate';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PAGE_WIDTH = SCREEN_WIDTH - 32;

/** Ikoner er skallens ansvar — et modul leverer data, ikke udseende. */
const SNAPSHOT_ICONS: Record<string, { ios: string; android: string; web: string }> = {
  economy: { ios: 'banknote', android: 'payments', web: 'payments' },
  food: { ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' },
  travel: { ios: 'airplane', android: 'flight', web: 'flight' },
  cycle: { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' },
  default: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' },
};

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const accentTints = useAccentTints();
  const brand = useBrandTints();
  const tint = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const warning = useThemeColor({}, 'warning');
  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';

  const now = new Date();
  const monthKey = getMonthKey(now);
  const todayKey = toLocalIsoDate(now);
  const greetingPeriod = getGreetingPeriod(now);
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const onRefresh = () => {
    setIsRefreshing(true);
    // Modulernes kort hentes på ny — de er et øjebliksbillede, ikke en levende
    // binding til en store, og skal derfor bedes om at opdatere sig.
    reloadSnapshots();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const onScrollPages = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / PAGE_WIDTH);
    setPageIndex(index);
  };

  // ---- Data ----
  // Home beder modulerne om små, typede kort. Den kender ikke længere en
  // eneste domæne-store til det — se docs/home-snapshots.md.
  const { snapshots, isLoading: snapshotsLoading, reload: reloadSnapshots } = useHomeSnapshots(HOME_SNAPSHOT_PROVIDERS);

  // Rækkefølgen er brugerens, ikke appens: fastgjort > presserende > senest
  // brugt, og intet andet. Se ADR-0011.
  const pinned = useHomeLayoutStore((s) => s.pinned);
  const hidden = useHomeLayoutStore((s) => s.hidden);
  const lastOpenedAt = useHomeLayoutStore((s) => s.lastOpenedAt);
  const togglePinned = useHomeLayoutStore((s) => s.togglePinned);
  const toggleHidden = useHomeLayoutStore((s) => s.toggleHidden);
  const detail = useHomeLayoutStore((s) => s.detail);
  const setCardDetail = useHomeLayoutStore((s) => s.setCardDetail);
  const layoutHasHydrated = useHomeLayoutStore((s) => s.hasHydrated);
  // Invitationen til det månedlige tilbageblik. Vises kun hvis brugeren ikke
  // har fravalgt den — og først når indstillingen er læst, så den ikke blinker
  // frem hos en, der har slået den fra.
  const showReviewOnHome = useReviewStore((s) => s.showOnHome);
  const reviewHasHydrated = useReviewStore((s) => s.hasHydrated);
  const reviewMonthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(`${previousMonthKey(now)}-01T12:00:00`),
  );

  const rankedSnapshots = rankHomeSnapshots(snapshots, { pinned, hidden, lastOpenedAt });
  const hiddenCards = hiddenModuleIds({ pinned, hidden, lastOpenedAt });

  const visibleCards = rankedSnapshots
    .map((snapshot) => ({
      snapshot,
      cardDetail: resolveCardDetail(snapshot, { hidden, detail }, layoutHasHydrated),
    }))
    // Følsomme kort holdes tilbage, indtil vi ved hvad brugeren har valgt (APP-013).
    .filter((card) => card.cardDetail !== 'hidden');

  // Forskellen på "vi ved det ikke endnu" og "der er ingenting" afgøres ét sted,
  // så Home aldrig påstår det sidste, mens det første er sandt.
  const gridState = resolveHomeGridState({
    isLoading: snapshotsLoading,
    preferencesHydrated: layoutHasHydrated,
    visibleCardCount: visibleCards.length,
    hiddenCardCount: hiddenCards.length,
    availableProviderCount: snapshots.length,
  });

  const openCardActions = (snapshot: (typeof rankedSnapshots)[number], label: string) => {
    const moduleId = snapshot.moduleId;
    const isPinned = pinned.includes(moduleId);
    const currentDetail = resolveCardDetail(snapshot, { hidden, detail }, layoutHasHydrated);

    Alert.alert(t('home.cardActionsTitle'), label, [
      // Maskering tilbydes kun, hvor der er noget at maskere — en indkøbsliste
      // har ingen hemmeligheder.
      ...(isMaskable(snapshot.sensitivity)
        ? [
            {
              text: currentDetail === 'masked' ? t('home.cardActionShowValue') : t('home.cardActionMaskValue'),
              onPress: () => setCardDetail(moduleId, currentDetail === 'masked' ? 'full' : 'masked'),
            },
          ]
        : []),
      {
        text: isPinned ? t('home.cardActionUnpin') : t('home.cardActionPin'),
        onPress: () => togglePinned(moduleId),
      },
      { text: t('home.cardActionHide'), onPress: () => toggleHidden(moduleId) },
      { text: t('warranties.cancel'), style: 'cancel' },
    ]);
  };

  const profileName = useProfileStore((s) => s.profile.name);

  // Økonomi, mad og opsparing læses ikke længere her — modulerne leverer deres
  // egne kort (APP-011). Kun madbudgettets tilstedeværelse bruges stadig, af
  // "næste handling" nedenfor.
  const foodMonthlyBudget = useFoodStore((s) => s.monthlyBudgetByMonth)[monthKey] ?? null;

  const trips = useTripsStore((s) => s.trips);
  const tripParticipants = useTripsStore((s) => s.participants);
  const respondToInvitation = useTripsStore((s) => s.respondToInvitation);
  const pendingInvitations = tripParticipants.filter((p) => p.status === 'pending');

  const warranties = useWarrantiesStore((s) => s.warranties);
  const expiringWarrantiesCount = warranties.filter((w) => {
    const d = daysUntil(w.expiryDate);
    return d >= 0 && d <= 30;
  }).length;

  const todos = useTodoStore((s) => s.todos);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const overdueTodosCount = todos.filter((td) => !td.completed && td.dueDate && daysUntil(td.dueDate) < 0).length;
  const todosToday = todos.filter((td) => !td.completed && td.dueDate && daysUntil(td.dueDate) === 0);
  const todosThisWeek = todos.filter((td) => !td.completed && td.dueDate && isDateInCurrentWeek(td.dueDate, locale));

  const householdTasks = useHouseholdStore((s) => s.tasks);
  const overdueHouseholdCount = householdTasks.filter((ht) => daysUntilDue(ht.lastDone, ht.frequency) < 0).length;
  const householdThisWeekCount = householdTasks.filter((ht) => {
    const days = daysUntilDue(ht.lastDone, ht.frequency);
    return days >= 0 && days <= 7;
  }).length;

  const habits = useHabitsStore((s) => s.habits);
  const toggleLogForDate = useHabitsStore((s) => s.toggleLogForDate);

  const topStreak = habits
    .map((h) => ({ habit: h, streak: getCurrentStreak(h.logs) }))
    .filter((x) => x.streak > 0)
    .sort((a, b) => b.streak - a.streak)[0];


  // ---- Attention items ----
  const attentionItems = [
    overdueTodosCount > 0 && {
      key: 'overdueTodos',
      label: t('home.attentionOverdueTodos', { count: overdueTodosCount }),
      color: danger,
      icon: { ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' },
      route: { pathname: '/todos', params: { from: 'home' } } as const,
    },
    todosToday.length > 0 && {
      key: 'dueTodayTodos',
      label: t('home.attentionDueTodayTodos', { count: todosToday.length }),
      color: warning,
      icon: { ios: 'calendar', android: 'event', web: 'event' },
      route: { pathname: '/todos', params: { from: 'home' } } as const,
    },
    expiringWarrantiesCount > 0 && {
      key: 'warranties',
      label: t('home.attentionWarranties', { count: expiringWarrantiesCount }),
      color: warning,
      icon: { ios: 'shield.lefthalf.filled', android: 'shield', web: 'shield' },
      route: { pathname: '/warranties', params: { from: 'home' } } as const,
    },
    overdueHouseholdCount > 0 && {
      key: 'household',
      label: t('home.attentionHouseholdOverdue', { count: overdueHouseholdCount }),
      color: danger,
      icon: { ios: 'wrench.fill', android: 'build', web: 'build' },
      route: { pathname: '/household', params: { from: 'home' } } as const,
    },
  ].filter(Boolean) as { key: string; label: string; color: string; icon: any; route: any }[];

  const totalAttentionCount = overdueTodosCount + todosToday.length + expiringWarrantiesCount + overdueHouseholdCount;
  const nextAction =
    overdueTodosCount > 0
      ? {
          title: t('home.nextActionOverdueTodosTitle'),
          subtitle: t('home.nextActionOverdueTodosSubtitle', { count: overdueTodosCount }),
          icon: { ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' },
          route: { pathname: '/todos', params: { from: 'home' } } as any,
          tone: danger,
        }
      : todosToday.length > 0
        ? {
            title: t('home.nextActionTodosTodayTitle'),
            subtitle: t('home.nextActionTodosTodaySubtitle', { count: todosToday.length }),
            icon: { ios: 'calendar', android: 'event', web: 'event' },
            route: { pathname: '/todos', params: { from: 'home' } } as any,
            tone: warning,
          }
        : expiringWarrantiesCount > 0
          ? {
              title: t('home.nextActionWarrantyTitle'),
              subtitle: t('home.nextActionWarrantySubtitle', { count: expiringWarrantiesCount }),
              icon: { ios: 'shield.lefthalf.filled', android: 'shield', web: 'shield' },
              route: { pathname: '/warranties', params: { from: 'home' } } as any,
              tone: warning,
            }
          : foodMonthlyBudget === null
            ? {
                title: t('home.nextActionFoodBudgetTitle'),
                subtitle: t('home.nextActionFoodBudgetSubtitle'),
                icon: { ios: 'cart.fill.badge.plus', android: 'shopping_cart', web: 'shopping_cart' },
                route: '/food/budget' as any,
                tone: brand.glowPrimary,
              }
            : {
                title: t('home.nextActionAllGoodTitle'),
                subtitle: t('home.nextActionAllGoodSubtitle'),
                icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
                route: '/search' as any,
                tone: brand.glowPrimary,
              };

  const quickActions = [
    {
      key: 'todo',
      title: t('home.quickTodoTitle'),
      subtitle: t('home.quickTodoSubtitle'),
      icon: { ios: 'checklist', android: 'checklist', web: 'checklist' },
      route: '/todos/new' as any,
      tone: brand.glowPrimary,
    },
    {
      key: 'expense',
      title: t('home.quickExpenseTitle'),
      subtitle: t('home.quickExpenseSubtitle'),
      icon: { ios: 'creditcard.fill', android: 'credit_card', web: 'credit_card' },
      route: '/expenses/new' as any,
      tone: accentTints.accent,
    },
    {
      key: 'food',
      title: t('home.quickFoodTitle'),
      subtitle: t('home.quickFoodSubtitle'),
      icon: { ios: 'calendar.badge.plus', android: 'event', web: 'event' },
      route: '/food/weekly-plan' as any,
      tone: brand.glowSecondary,
    },
    {
      key: 'warranty',
      title: t('home.quickWarrantyTitle'),
      subtitle: t('home.quickWarrantySubtitle'),
      icon: { ios: 'shield.fill', android: 'shield', web: 'shield' },
      route: '/warranties/new' as any,
      tone: accentTints.accent,
    },
  ];

  return (
    <Screen
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={tint} />}>
      {/* Hero */}
      <Card style={[styles.hero, { backgroundColor: brand.ink, overflow: 'hidden' }]}>
        <View style={[styles.heroRoseGlow, { backgroundColor: brand.glowPrimary }]} />
        <View style={[styles.heroAmberGlow, { backgroundColor: brand.glowSecondary }]} />
        <View style={styles.heroTopLine}>
          <Text style={[styles.heroKicker, { color: brand.kickerOnBrand }]}>{t('home.commandCenterLabel')}</Text>
          <View style={styles.heroStatusPill}>
            <Text style={[styles.heroStatusText, { color: brand.onBrand }]}>{totalAttentionCount > 0 ? totalAttentionCount : t('home.zeroAttention')}</Text>
          </View>
        </View>
        <Text style={[styles.heroGreeting, { color: brand.onBrand }]}>
          {t(`home.greeting.${greetingPeriod}`)}{profileName ? `, ${profileName}` : ''}
        </Text>
        <Text style={[styles.heroDate, { color: brand.onBrand }]}>{dateLabel}</Text>
        <Text style={[styles.heroSubtitle, { color: brand.onBrand }]}>
          {totalAttentionCount > 0 ? t('home.attentionSubtitle', { count: totalAttentionCount }) : t('home.allGoodSubtitle')}
        </Text>
        {topStreak && (
          <Text style={[styles.heroStreak, { color: brand.onBrand }]}>
            {t('home.heroStreak', { days: topStreak.streak, habit: topStreak.habit.title })}
          </Text>
        )}
      </Card>

      {/* Invitationer til delte rejser */}
      {pendingInvitations.length > 0 && (
        <View style={styles.invitationsSection}>
          <Kicker
            label={t('home.invitationsLabel')}
            color={accentTints.accent}
            backgroundColor={accentTints.accentSoft}
            icon={{ ios: 'envelope.fill', android: 'mail', web: 'mail' }}
          />
          {pendingInvitations.map((inv) => {
            const trip = trips.find((tr) => tr.id === inv.tripId);
            return (
              <Card key={`${inv.tripId}-${inv.userId}`} style={[styles.invitationCard, { borderColor: accentTints.accentSoft }]}>
                <View style={styles.invitationTextGroup}>
                  <Text style={styles.invitationTripName}>{trip?.name ?? t('home.invitationUnknownTrip')}</Text>
                  <Text style={{ color: textMuted, fontSize: 12 }}>{t('home.invitationSubtitle')}</Text>
                </View>
                <View style={styles.invitationButtons}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('home.a11y.acceptInvitation', { trip: trip?.name ?? t('home.invitationUnknownTrip') })}
                    hitSlop={5}
                    style={[styles.invitationButton, { backgroundColor: accentTints.accent }]}
                    onPress={() => respondToInvitation(inv.tripId, true)}
                  >
                    <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={14} tintColor="#FFFFFF" />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('home.a11y.declineInvitation', { trip: trip?.name ?? t('home.invitationUnknownTrip') })}
                    hitSlop={5}
                    style={[styles.invitationButton, { backgroundColor: textMuted }]}
                    onPress={() => respondToInvitation(inv.tripId, false)}
                  >
                    <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor="#FFFFFF" />
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <SectionHeader
        eyebrow={t('home.nextActionEyebrow')}
        title={t('home.nextActionTitle')}
        subtitle={t('home.nextActionHelper')}
      />
      <QuickActionCard
        icon={nextAction.icon}
        title={nextAction.title}
        subtitle={nextAction.subtitle}
        actionLabel={t('home.openAction')}
        tone={nextAction.tone}
        onPress={() => router.push(nextAction.route)}
      />

      {/* Attention */}
      {attentionItems.length > 0 && (
        <>
          <SectionHeader title={t('home.attentionTitle')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attentionRow}>
            {attentionItems.map((item) => (
              <Pressable accessibilityRole="button" key={item.key} onPress={() => router.push(item.route)}>
                <Card style={[styles.attentionCard, { borderColor: item.color, borderWidth: 1.5 }]}>
                  <SymbolView name={item.icon} size={20} tintColor={item.color} />
                  <Text style={[styles.attentionLabel, { color: item.color }]}>{item.label}</Text>
                </Card>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      <SectionHeader
        title={t('home.quickActionsTitle')}
        subtitle={t('home.quickActionsSubtitle')}
      />
      <View style={styles.quickActions}>
        {quickActions.map((action) => (
          <QuickActionCard
            key={action.key}
            icon={action.icon}
            title={action.title}
            subtitle={action.subtitle}
            tone={action.tone}
            onPress={() => router.push(action.route)}
          />
        ))}
      </View>

      {/* Swipeable: I dag / Denne uge */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollPages}
        style={{ width: PAGE_WIDTH }}>
        {/* Side 1: I dag */}
        <View style={{ width: PAGE_WIDTH, gap: 10 }}>
          <Text style={sharedStyles.sectionLabel}>{t('home.todayTitle')}</Text>

          <Card style={styles.todayCard}>
            <Text style={[styles.todaySubLabel, { color: textMuted }]}>{t('home.habitsTodayLabel')}</Text>
            {habits.length === 0 ? (
              <Text style={{ color: textMuted, fontSize: 13 }}>{t('home.noHabitsYet')}</Text>
            ) : (
              <View style={sharedStyles.chipRow}>
                {habits.map((h) => (
                  <Chip
                    key={h.id}
                    label={h.title}
                    active={hasLoggedToday(h.logs)}
                    onPress={() => toggleLogForDate(h.id, todayKey)}
                  />
                ))}
              </View>
            )}
          </Card>

          <Card style={styles.todayCard}>
            <Text style={[styles.todaySubLabel, { color: textMuted }]}>{t('home.todosTodayLabel')}</Text>
            {todosToday.length === 0 ? (
              <Text style={{ color: textMuted, fontSize: 13 }}>{t('home.noTodosToday')}</Text>
            ) : (
              <View style={styles.todoList}>
                {todosToday.map((td) => (
                  <Pressable accessibilityRole="button" key={td.id} style={styles.todoRow} onPress={() => toggleTodo(td.id)}>
                    <SymbolView
                      name={{
                        ios: td.completed ? 'checkmark.circle.fill' : 'circle',
                        android: td.completed ? 'check_circle' : 'radio_button_unchecked',
                        web: td.completed ? 'check_circle' : 'radio_button_unchecked',
                      }}
                      tintColor={tint}
                      size={20}
                    />
                    <Text style={styles.todoTitle}>{td.title}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        </View>

        {/* Side 2: Denne uge */}
        <View style={{ width: PAGE_WIDTH, gap: 10 }}>
          <Text style={sharedStyles.sectionLabel}>{t('home.thisWeekTitle')}</Text>

          {todosThisWeek.length === 0 && householdThisWeekCount === 0 && habits.length === 0 ? (
            <Card style={sharedStyles.emptyCard}>
              <Text style={{ color: textMuted }}>{t('home.noWeekActivity')}</Text>
            </Card>
          ) : (
            <>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/todos', params: { from: 'home' } } as any)}>
                <Card style={styles.weekRow}>
                  <SymbolView name={{ ios: 'checklist', android: 'checklist', web: 'checklist' }} size={18} tintColor={tint} />
                  <Text style={styles.weekRowText}>{t('home.weekTodosLabel', { count: todosThisWeek.length })}</Text>
                </Card>
              </Pressable>

              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/household', params: { from: 'home' } } as any)}>
                <Card style={styles.weekRow}>
                  <SymbolView name={{ ios: 'wrench.fill', android: 'build', web: 'build' }} size={18} tintColor={tint} />
                  <Text style={styles.weekRowText}>{t('home.weekHouseholdLabel', { count: householdThisWeekCount })}</Text>
                </Card>
              </Pressable>

              {habits.length > 0 && (
                <Card style={styles.todayCard}>
                  <Text style={[styles.todaySubLabel, { color: textMuted }]}>{t('home.weekHabitsLabel')}</Text>
                  {habits.map((h) => {
                    const loggedThisWeek = h.logs.filter((l) => isDateInCurrentWeek(l.date.slice(0, 10), locale)).length;
                    return (
                      <View key={h.id} style={styles.weekHabitRow}>
                        <Text style={styles.weekHabitTitle}>{h.title}</Text>
                        <Text style={{ color: textMuted, fontSize: 12 }}>{loggedThisWeek}/7</Text>
                      </View>
                    );
                  })}
                </Card>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Page dots */}
      <View style={styles.dotsRow}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === pageIndex ? tint : textMuted, opacity: i === pageIndex ? 1 : 0.3 }]}
          />
        ))}
      </View>

      {/* Overview snapshot grid */}
      <SectionHeader title={t('home.overviewTitle')} subtitle={t('home.overviewSubtitle')} />
      {gridState === 'loading' && (
        <View
          style={styles.grid}
          accessibilityLabel={t('home.loadingAccessibility')}
          accessibilityRole="progressbar"
        >
          {Array.from({ length: skeletonCardCount(snapshots.length) }, (_, index) => (
            <MetricCardSkeleton key={index} style={styles.gridCell} />
          ))}
        </View>
      )}

      {/* Aldrig "der er ingenting" uden også at sige hvorfor, og hvad man gør
          ved det. En tom skærm uden forklaring ligner tabte data. */}
      {gridState !== 'loading' && gridState !== 'ready' && (
        <Card style={sharedStyles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {gridState === 'empty-hidden'
              ? t('home.emptyHiddenTitle')
              : gridState === 'empty-no-modules'
                ? t('home.emptyNoModulesTitle')
                : t('home.emptyNoCardsTitle')}
          </Text>
          <Text style={[styles.emptyBody, { color: textMuted }]}>
            {gridState === 'empty-hidden'
              ? t('home.emptyHiddenBody')
              : gridState === 'empty-no-modules'
                ? t('home.emptyNoModulesBody')
                : t('home.emptyNoCardsBody')}
          </Text>
        </Card>
      )}

      <View style={styles.grid}>
        {visibleCards.map(({ snapshot, cardDetail }) => {
          const masked = cardDetail === 'masked';
          return (
          <MetricCard
            key={snapshot.moduleId}
            style={styles.gridCell}
            icon={SNAPSHOT_ICONS[snapshot.moduleId] ?? SNAPSHOT_ICONS.default}
            label={t(snapshot.titleKey)}
            value={
              masked
                ? MASKED_VALUE
                : snapshot.value ??
                  (snapshot.valueKey ? t(snapshot.valueKey, snapshot.valueParams) : '—')
            }
            helper={
              masked
                ? t('home.maskedHelper')
                : snapshot.helperKey
                  ? t(snapshot.helperKey, snapshot.helperParams)
                  : undefined
            }
            tone={snapshot.priority === 'urgent' ? danger : snapshot.priority === 'important' ? warning : accentTints.accent}
            onPress={() => router.push(snapshot.route as any)}
            onLongPress={() => openCardActions(snapshot, t(snapshot.titleKey))}
            accessibilityLabel={masked ? `${t(snapshot.titleKey)} — ${t('home.maskedAccessibility')}` : undefined}
            accessibilityHint={t('home.cardActionsHint')}
            accessibilityActions={[
              { name: 'pin', label: pinned.includes(snapshot.moduleId) ? t('home.cardActionUnpin') : t('home.cardActionPin') },
              { name: 'hide', label: t('home.cardActionHide') },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'pin') togglePinned(snapshot.moduleId);
              if (event.nativeEvent.actionName === 'hide') toggleHidden(snapshot.moduleId);
            }}
          />
          );
        })}
      </View>

      {reviewHasHydrated && showReviewOnHome && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('review.homeInvitation', { month: reviewMonthLabel })}
          onPress={() => router.push('/review')}
          style={styles.reviewRow}
        >
          <Text style={styles.reviewText}>{t('review.homeInvitation', { month: reviewMonthLabel })}</Text>
        </Pressable>
      )}

      {/* Uden en vej tilbage ville "skjul" i praksis være "slet kortet". */}
      {hiddenCards.length > 0 && (
        <>
          <SectionHeader title={t('home.hiddenSectionTitle')} subtitle={t('home.hiddenSectionSubtitle')} />
          <View style={styles.hiddenRow}>
            {hiddenCards.map((moduleId) => (
              <Pressable
                key={moduleId}
                accessibilityRole="button"
                accessibilityLabel={`${t(getModule(moduleId).titleKey)} — ${t('home.restoreCard')}`}
                onPress={() => toggleHidden(moduleId)}
                style={styles.hiddenChip}
              >
                <Text style={styles.hiddenChipText}>{t(getModule(moduleId).titleKey)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = {
  reviewRow: {
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(128,128,128,0.3)',
  },
  reviewText: { fontSize: 15, fontWeight: '600' as const },
  emptyTitle: { fontSize: 15, fontWeight: '700' as const },
  emptyBody: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  hiddenRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, backgroundColor: 'transparent' },
  hiddenChip: {
    minHeight: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.35)',
  },
  hiddenChipText: { fontSize: 13, fontWeight: '600' as const },
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  hero: { padding: 20, gap: 4, position: 'relative' as const, borderRadius: 24 },
  heroRoseGlow: { position: 'absolute' as const, width: 220, height: 220, borderRadius: 110, top: -92, right: -62, opacity: 0.24 },
  heroAmberGlow: { position: 'absolute' as const, width: 140, height: 140, borderRadius: 70, bottom: -58, left: -36, opacity: 0.14 },
  heroTopLine: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 12, backgroundColor: 'transparent' },
  heroKicker: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.6, backgroundColor: 'transparent' },
  heroStatusPill: { minWidth: 34, height: 26, borderRadius: 13, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.12)' },
  heroStatusText: { fontSize: 12, fontWeight: '800' as const, backgroundColor: 'transparent' },
  heroGreeting: { fontSize: 26, fontWeight: '800' as const, backgroundColor: 'transparent' },
  heroDate: { fontSize: 14, opacity: 0.9, textTransform: 'capitalize' as const, marginTop: 2 },
  heroSubtitle: { fontSize: 13, opacity: 0.85, marginTop: 10, backgroundColor: 'transparent' },
  heroStreak: { fontSize: 13, fontWeight: '700' as const, marginTop: 8, backgroundColor: 'transparent' },
  invitationsSection: { gap: 8 },
  invitationCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, borderWidth: 1.5 },
  invitationTextGroup: { flex: 1, gap: 1 },
  invitationTripName: { fontWeight: '800' as const, fontSize: 15 },
  invitationButtons: { flexDirection: 'row' as const, gap: 8 },
  invitationButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center' as const, justifyContent: 'center' as const },
  attentionRow: { gap: 10, paddingRight: 8 },
  attentionCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 10, paddingHorizontal: 14 },
  attentionLabel: { fontSize: 13, fontWeight: '700' as const },
  quickActions: { gap: 10 },
  todayCard: { gap: 8 },
  todaySubLabel: { fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  todoList: { gap: 8 },
  todoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  todoTitle: { fontSize: 14, fontWeight: '600' as const },
  weekRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  weekRowText: { fontSize: 14, fontWeight: '600' as const },
  weekHabitRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 3 },
  weekHabitTitle: { fontSize: 13, fontWeight: '600' as const },
  dotsRow: { flexDirection: 'row' as const, justifyContent: 'center' as const, gap: 6, marginTop: -4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
  gridCell: { width: '47%' as const },
};

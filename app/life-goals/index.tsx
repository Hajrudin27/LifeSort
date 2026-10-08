import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import RingProgress from '@/components/RingProgress';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { goalIsCompleted, goalMilestoneSummary, goalProgress } from '@/features/goals/domain/goal';
import { goalValueText } from '@/features/goals/goalDisplay';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';

export default function LifeGoalsScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const goals = useLifeGoalsStore((s) => s.goals);
  const [showCompleted, setShowCompleted] = useState(false);

  // One definition of completion, shared with the detail screen and the Life dashboard.
  const visibleGoals = goals.filter((g) => showCompleted || !goalIsCompleted(g));

  return (
    <View style={sharedStyles.formContainer}>
      <View style={sharedStyles.chipRow}>
        <Chip label={t('lifeGoals.activeLabel')} active={!showCompleted} onPress={() => setShowCompleted(false)} />
        <Chip label={t('lifeGoals.showCompleted')} active={showCompleted} onPress={() => setShowCompleted(true)} />
      </View>

      <FlatList
        data={visibleGoals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('lifeGoals.emptyState')}</Text>
          </Card>
        }
        renderItem={({ item }) => {
          const progress = goalProgress(item);
          const { done, total } = goalMilestoneSummary(item);

          return (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/life-goals/${item.id}`)}>
              <Card style={styles.card}>
                <View style={styles.row}>
                  <RingProgress progress={progress} size={48} strokeWidth={5} showLabel={false} />
                  <View style={styles.textWrap}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={[styles.meta, { color: textMuted }]}>{goalValueText(item, t, i18n.language)}</Text>
                    {total > 0 && (
                      // Supporting text only: milestones never drive the ring.
                      <Text style={[styles.meta, { color: textMuted }]}>
                        {t('lifeGoals.milestoneProgress', { done, total, count: total })}
                      </Text>
                    )}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      <Button label={t('lifeGoals.addButton')} onPress={() => router.push('/life-goals/new')} />
    </View>
  );
}

const styles = {
  card: {},
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  textWrap: { flex: 1 },
  title: { fontWeight: '700' as const, fontSize: 16 },
  meta: { fontSize: 13, marginTop: 2 },
};
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
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';

export default function LifeGoalsScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const goals = useLifeGoalsStore((s) => s.goals);
  const [showCompleted, setShowCompleted] = useState(false);

  const isCompleted = (total: number, done: number) => total > 0 && done === total;

  const visibleGoals = goals.filter((g) => {
    const total = g.subGoals.length;
    const done = g.subGoals.filter((sg) => sg.completed).length;
    return showCompleted || !isCompleted(total, done);
  });

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
          const done = item.subGoals.filter((sg) => sg.completed).length;
          const total = item.subGoals.length;
          const progress = total > 0 ? done / total : 0;

          return (
            <Pressable onPress={() => router.push(`/life-goals/${item.id}`)}>
              <Card style={styles.card}>
                <View style={styles.row}>
                  <RingProgress progress={progress} size={48} strokeWidth={5} showLabel={false} />
                  <View style={styles.textWrap}>
                    <Text style={styles.title}>{item.title}</Text>
                    {total > 0 && (
                      <Text style={[styles.meta, { color: textMuted }]}>
                        {t('lifeGoals.progressLabel', { done, total })}
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
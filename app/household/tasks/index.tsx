import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';

import { AssigneeAvatar } from '@/components/AssigneeSelector';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { TaskKind } from '@/types/household';
import { daysUntilDue } from '@/utils/household/householdTaskSchedule';

export default function HouseholdTasksScreen() {
  const { t } = useTranslation();
  const { kind } = useLocalSearchParams<{ kind: TaskKind }>();
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const warning = useThemeColor({}, 'warning');

  const allTasks = useHouseholdStore((s) => s.tasks);
  const markTaskDone = useHouseholdStore((s) => s.markTaskDone);
  const tasks = allTasks.filter((t) => t.kind === kind);

  const screenTitle = kind === 'cleaning' ? t('household.cleaningLabel') : t('household.maintenanceLabel');

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: screenTitle }} />

      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('household.emptyTasks')}</Text>
          </Card>
        }
        renderItem={({ item }) => {
          const days = daysUntilDue(item.lastDone, item.frequency);
          const dueColor = days < 0 ? danger : days === 0 ? warning : textMuted;
          const dueLabel = days < 0 ? t('household.overdue') : days === 0 ? t('household.dueToday') : t('household.dueIn', { days });

          return (
            <Card style={styles.row}>
              <Pressable style={styles.titleWrap} onPress={() => router.push(`/household/tasks/${item.id}`)}>
                <View style={styles.titleRow}>
                  <AssigneeAvatar assignee={item.assignedTo} size={26} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={[styles.meta, { color: dueColor }]}>{dueLabel}</Text>
                  </View>
                </View>
              </Pressable>
              <Pressable style={[styles.doneButton]} onPress={() => markTaskDone(item.id)}>
                <Text style={styles.doneButtonText}>{t('household.markDone')}</Text>
              </Pressable>
            </Card>
          );
        }}
      />

      <Button
        label={t('household.addTask')}
        onPress={() => router.push({ pathname: '/household/tasks/new', params: { kind } })}
      />
    </View>
  );
}

const styles = {
  row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  titleWrap: { flex: 1 },
  titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  title: { fontWeight: '700' as const },
  meta: { fontSize: 13, marginTop: 2 },
  doneButton: { paddingVertical: 6, paddingHorizontal: 10 },
  doneButtonText: { fontSize: 13, fontWeight: '600' as const },
};
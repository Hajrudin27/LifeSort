import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHomeBackTitle } from '@/hooks/useHomeBackTitle';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { daysUntilDue } from '@/utils/household/householdTaskSchedule';

export default function HouseholdScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const tasks = useHouseholdStore((s) => s.tasks);
  const shoppingItems = useHouseholdStore((s) => s.shoppingItems);
  const movingItems = useHouseholdStore((s) => s.movingItems);

  const cleaningDue = tasks.filter((t) => t.kind === 'cleaning' && daysUntilDue(t.lastDone, t.frequency) <= 0).length;
  const maintenanceDue = tasks.filter((t) => t.kind === 'maintenance' && daysUntilDue(t.lastDone, t.frequency) <= 0).length;
  const movingDone = movingItems.filter((i) => i.checked).length;

  return (
    <View style={sharedStyles.formContainer}>
      <Pressable onPress={() => router.push({ pathname: '/household/tasks', params: { kind: 'cleaning' } })}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('household.cleaningLabel')}</Text>
          {cleaningDue > 0 && <Text style={{ color: danger }}>{cleaningDue}</Text>}
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push({ pathname: '/household/tasks', params: { kind: 'maintenance' } })}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('household.maintenanceLabel')}</Text>
          {maintenanceDue > 0 && <Text style={{ color: danger }}>{maintenanceDue}</Text>}
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push('/household/shopping-list')}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('household.shoppingListLabel')}</Text>
          <Text style={{ color: textMuted }}>{shoppingItems.length}</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push('/household/moving')}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('household.movingLabel')}</Text>
          <Text style={{ color: textMuted }}>{movingDone}/{movingItems.length}</Text>
        </Card>
      </Pressable>
    </View>
  );
}

const styles = {
  linkText: { fontWeight: '700' as const },
};
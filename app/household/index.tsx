import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useHomeBackTitle } from '@/hooks/useHomeBackTitle';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { daysUntilDue } from '@/utils/household/householdTaskSchedule';

type IconName = { ios: string; android: string; web: string };

export default function HouseholdScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const accentTints = useAccentTints();

  const tasks = useHouseholdStore((s) => s.tasks);
  const shoppingItems = useHouseholdStore((s) => s.shoppingItems);
  const movingItems = useHouseholdStore((s) => s.movingItems);

  const cleaningDue = tasks.filter((t) => t.kind === 'cleaning' && daysUntilDue(t.lastDone, t.frequency) <= 0).length;
  const maintenanceDue = tasks.filter((t) => t.kind === 'maintenance' && daysUntilDue(t.lastDone, t.frequency) <= 0).length;
  const movingDone = movingItems.filter((i) => i.checked).length;

  const rows: {
    key: string;
    label: string;
    icon: IconName;
    value?: string | number;
    valueColor?: string;
    onPress: () => void;
  }[] = [
    {
      key: 'cleaning',
      label: t('household.cleaningLabel'),
      icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
      value: cleaningDue > 0 ? cleaningDue : undefined,
      valueColor: danger,
      onPress: () => router.push({ pathname: '/household/tasks', params: { kind: 'cleaning' } }),
    },
    {
      key: 'maintenance',
      label: t('household.maintenanceLabel'),
      icon: { ios: 'wrench.and.screwdriver.fill', android: 'build', web: 'build' },
      value: maintenanceDue > 0 ? maintenanceDue : undefined,
      valueColor: danger,
      onPress: () => router.push({ pathname: '/household/tasks', params: { kind: 'maintenance' } }),
    },
    {
      key: 'shopping',
      label: t('household.shoppingListLabel'),
      icon: { ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' },
      value: shoppingItems.length,
      valueColor: textMuted,
      onPress: () => router.push('/household/shopping-list'),
    },
    {
      key: 'moving',
      label: t('household.movingLabel'),
      icon: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' },
      value: `${movingDone}/${movingItems.length}`,
      valueColor: textMuted,
      onPress: () => router.push('/household/moving'),
    },
  ];

  return (
    <View style={sharedStyles.formContainer}>
      {rows.map((row) => (
        <Pressable key={row.key} onPress={row.onPress}>
          <Card style={styles.row}>
            <View style={styles.left}>
              <View style={[styles.iconCircle, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={row.icon as any} size={18} tintColor={accentTints.accent} />
              </View>
              <Text style={styles.linkText}>{row.label}</Text>
            </View>
            {row.value !== undefined && (
              <Text style={[styles.value, { color: row.valueColor }]}>{row.value}</Text>
            )}
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontWeight: '700' },
  value: { fontWeight: '700', fontSize: 14 },
});
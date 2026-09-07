import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import SwipeableRow from '@/components/SwipeableRow';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';

function daysBetween(a: string, b: string): number {
  const diffMs = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export default function CycleHistoryScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const textMuted = useThemeColor({}, 'textMuted');
  const cycles = useCycleStore((s) => s.cycles);
  const removeCycle = useCycleStore((s) => s.removeCycle);

  const sorted = [...cycles].sort((a, b) => b.startDate.localeCompare(a.startDate));

  const confirmDelete = (id: string) => {
    Alert.alert(t('cycle.deleteConfirmTitle'), t('cycle.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('cycle.delete'), style: 'destructive', onPress: () => removeCycle(id) },
    ]);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={[sharedStyles.emptyCard, { backgroundColor: cycleTints.accentSoft }]}>
            <Text style={{ color: textMuted }}>{t('cycle.emptyHistory')}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <SwipeableRow onDelete={() => confirmDelete(item.id)}>
            <Pressable accessibilityRole="button" onPress={() => router.push(`/cycle/${item.id}`)}>
              <Card style={[styles.card, { borderColor: cycleTints.accentSoft }]}>
                <View style={styles.iconWrap}>
                  <View style={[styles.iconGlow, { backgroundColor: cycleTints.accentSoft }]} />
                  <View style={[styles.iconCircle, { backgroundColor: cycleTints.accent }]}>
                    <SymbolView name={{ ios: 'drop.fill', android: 'water_drop', web: 'water_drop' }} size={15} tintColor="#FFFFFF" />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.date}>{item.startDate}</Text>
                  {item.endDate && <Text style={{ color: textMuted, fontSize: 12 }}>→ {item.endDate}</Text>}
                </View>
                {item.endDate && (
                  <View style={[styles.lengthBadge, { backgroundColor: cycleTints.accentSoft }]}>
                    <Text style={[styles.lengthBadgeText, { color: cycleTints.accent }]}>
                      {t('cycle.cycleLengthLabel', { days: daysBetween(item.startDate, item.endDate) + 1 })}
                    </Text>
                  </View>
                )}
              </Card>
            </Pressable>
          </SwipeableRow>
        )}
      />
      <Button label={t('cycle.addPastCycleButton')} onPress={() => router.push('/cycle/new')} />
    </View>
  );
}

const styles = {
  card: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, borderWidth: 1.5 },
  iconWrap: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const },
  iconGlow: { position: 'absolute' as const, width: 34, height: 34, borderRadius: 17 },
  iconCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
  date: { fontWeight: '800' as const, fontSize: 15 },
  lengthBadge: { borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  lengthBadgeText: { fontSize: 11, fontWeight: '800' as const },
};
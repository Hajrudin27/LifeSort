import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useTripsStore } from '@/store/useTripsStore';
import { getTripCategoryLabel } from '@/utils/trip/tripExpenseCategoryLabel';

export default function TripExpensesScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const textMuted = useThemeColor({}, 'textMuted');

  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === id));
  const allExpenses = useTripsStore((s) => s.expenses);
  const expenses = allExpenses.filter((e) => e.tripId === id);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: trip?.name ?? t('travel.expensesLabel') }} />

      <Text style={styles.total}>{total.toFixed(2)} kr.</Text>

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={[styles.empty, { color: textMuted }]}>{t('expenses.emptyState')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/travel/[id]/expenses/edit/[expenseId]',
                params: { id: id!, expenseId: item.id },
              })
            }>
            <Card style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={[styles.meta, { color: textMuted }]}>{getTripCategoryLabel(item.category, t)}</Text>
              </View>
              <View style={styles.amountGroup}>
                <Text style={styles.amount}>{item.amount.toFixed(2)} kr.</Text>
                {item.currency && item.originalAmount !== undefined && (
                  <Text style={[styles.originalAmount, { color: textMuted }]}>
                    {item.originalAmount.toFixed(2)} {item.currency}
                  </Text>
                )}
              </View>
            </Card>
          </Pressable>
        )}
      />

      <Button
        label={t('expenses.addButton')}
        onPress={() => router.push({ pathname: '/travel/[id]/expenses/new', params: { id: id! } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  total: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  list: { gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowText: { flex: 1 },
  name: { fontWeight: '700' },
  meta: { fontSize: 13, marginTop: 2 },
  amountGroup: { alignItems: 'flex-end' },
  amount: { fontWeight: '700' },
  originalAmount: { fontSize: 11, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 24 },
});
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import TripAttachmentGrid from '@/components/TripAttachmentGrid';
import { useTripsStore } from '@/store/useTripsStore';
import { TripExpenseCategory } from '@/types/trip';

const CATEGORIES: TripExpenseCategory[] = ['flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other'];

export default function EditTripExpenseScreen() {
  const { t } = useTranslation();
  const { expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const expense = useTripsStore((s) => s.expenses.find((e) => e.id === expenseId));
  const updateTripExpense = useTripsStore((s) => s.updateTripExpense);
  const removeTripExpense = useTripsStore((s) => s.removeTripExpense);
  const addExpenseAttachment = useTripsStore((s) => s.addExpenseAttachment);
  const removeExpenseAttachment = useTripsStore((s) => s.removeExpenseAttachment);

  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense?.amount.toString() ?? '');
  const [category, setCategory] = useState<TripExpenseCategory>(expense?.category ?? 'flight');

  if (!expense) {
    return (
      <View style={styles.container}>
        <Text>{t('expenses.emptyState')}</Text>
      </View>
    );
  }

  const canSave = name.trim().length > 0 && !isNaN(parseFloat(amount));

  const save = () => {
    updateTripExpense(expense.id, { name: name.trim(), amount: parseFloat(amount), category });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t('expenses.deleteConfirmTitle'), t('expenses.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      {
        text: t('warranties.delete'),
        style: 'destructive',
        onPress: () => {
          removeTripExpense(expense.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: expense.name }} />

      <Card style={styles.card}>
        <TextInput
          style={[styles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('expenses.namePlaceholder')}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[styles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('expenses.amountPlaceholder')}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />

        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={t(`travel.categories.${c}`)} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </Card>

      <Text style={styles.sectionLabel}>{t('travel.receiptsLabel')}</Text>
      <Card>
        <TripAttachmentGrid
          attachments={expense.attachments}
          onAdd={(a) => addExpenseAttachment(expense.id, a)}
          onRemove={(attachmentId) => removeExpenseAttachment(expense.id, attachmentId)}
        />
      </Card>

      <Button label={t('expenses.save')} disabled={!canSave} onPress={save} />
      <Button label={t('expenses.delete')} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { gap: 14 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { opacity: 0.6, fontSize: 13, fontWeight: '600' },
});
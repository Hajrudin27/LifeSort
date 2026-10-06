import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { parseSupportedMoneyInput } from '@/core/money/supportedMoney';
import TripAttachmentGrid from '@/components/TripAttachmentGrid';
import {
  canResolveLegacyTripExpense,
  legacyResolutionPending,
  projectionVisibleTo,
} from '@/features/travel/financialReadContract';
import { useAuthStore } from '@/store/useAuthStore';
import { useTripsStore } from '@/store/useTripsStore';
import { TripExpenseCategory } from '@/types/trip';
import { parseCalendarDate } from '@/utils/shared/localDate';

const CATEGORIES: TripExpenseCategory[] = ['flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other'];

export default function EditTripExpenseScreen() {
  const { t } = useTranslation();
  const { expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const success = useThemeColor({}, 'success');

  const expense = useTripsStore((s) => s.expenses.find((e) => e.id === expenseId));
  const trip = useTripsStore((s) => s.trips.find((candidate) => candidate.id === expense?.tripId));
  const financialProjections = useTripsStore((s) => s.financialProjections);
  const myUserId = useTripsStore((s) => s.myUserId);
  const sessionUserId = useAuthStore((s) => s.session?.user.id);
  const resolveLegacyTripExpense = useTripsStore((s) => s.resolveLegacyTripExpense);
  const removeTripExpense = useTripsStore((s) => s.removeTripExpense);
  const addExpenseAttachment = useTripsStore((s) => s.addExpenseAttachment);
  const removeExpenseAttachment = useTripsStore((s) => s.removeExpenseAttachment);

  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense?.amount.toString() ?? '');
  const [category, setCategory] = useState<TripExpenseCategory>(expense?.category ?? 'flight');
  const [transactionDate, setTransactionDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedAttachmentsPending, setSavedAttachmentsPending] = useState(false);

  if (!expense) {
    return (
      <View style={styles.container}>
        <Text>{t('expenses.emptyState')}</Text>
      </View>
    );
  }

  // Reachable by URL too, so the screen applies the same fail-closed rule as the list.
  const canResolve = canResolveLegacyTripExpense(expense, trip, sessionUserId);
  // Already saved as a canonical Economy expense (this save, or the server's own record):
  // only the attachment handoff is still finishing, so there is nothing left to submit.
  const attachmentsPending = savedAttachmentsPending || legacyResolutionPending(
    expense.id, projectionVisibleTo(myUserId, sessionUserId) ? financialProjections : [], sessionUserId,
  );
  const parsedAmount = parseSupportedMoneyInput(amount);
  const canSave = canResolve && !attachmentsPending && name.trim().length > 0 && parsedAmount.ok
    && parsedAmount.value >= 0 && parseCalendarDate(transactionDate) !== null && !isSaving;

  const save = async () => {
    if (!parsedAmount.ok || !canSave) return;
    setIsSaving(true);
    setSaveFailed(false);
    const outcome = await resolveLegacyTripExpense({
      id: expense.id,
      name: name.trim(),
      amount: parsedAmount.value,
      category,
      transactionDate,
    });
    setIsSaving(false);
    if (outcome === 'failed') {
      setSaveFailed(true);
      return;
    }
    if (outcome === 'attachments-pending') {
      // Saved — not a failure. Stay and say so; the attachments finish automatically.
      setSavedAttachmentsPending(true);
      return;
    }
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

      {attachmentsPending ? (
        <Text accessibilityRole="alert" style={[styles.saved, { color: success }]}>
          {t('travel.legacyAttachmentsPendingDetail')}
        </Text>
      ) : (
        <Text accessibilityRole="alert" style={styles.unresolved}>
          {canResolve ? t('travel.legacyExpenseNeedsDate') : t('travel.legacyExpenseAuthorOnly')}
        </Text>
      )}

      <Card style={styles.card}>
        <TextInput
          style={[styles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('expenses.namePlaceholder')}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.sectionLabel}>{t('travel.transactionDateLabel')}</Text>
        <DatePickerField value={transactionDate} onChange={setTransactionDate} />
        <Text style={styles.hint}>{t('travel.legacyDateResolutionHint')}</Text>
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

      {saveFailed && <Text accessibilityRole="alert" style={styles.unresolved}>{t('travel.expenseSaveFailed')}</Text>}
      {canResolve && !attachmentsPending && (
        <Button label={isSaving ? t('travel.savingExpense') : t('travel.resolveExpense')} disabled={!canSave} onPress={save} />
      )}
      {/* While the handoff finishes, this row is the only owner of its attachment files. */}
      {!attachmentsPending && <Button label={t('expenses.delete')} variant="danger" onPress={confirmDelete} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { gap: 14 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { opacity: 0.6, fontSize: 13, fontWeight: '600' },
  hint: { opacity: 0.65, fontSize: 12 },
  unresolved: { color: '#B45309', fontWeight: '600' },
  saved: { fontWeight: '600' },
});

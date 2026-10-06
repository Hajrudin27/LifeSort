import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { newEntityId } from '@/core/ids';
import { minorUnitsToDecimalString } from '@/core/money/decimal';
import { parseSupportedMoneyInput } from '@/core/money/supportedMoney';
import { useAuthStore } from '@/store/useAuthStore';
import { useTripsStore } from '@/store/useTripsStore';
import { TripExpenseCategory } from '@/types/trip';
import { parseCalendarDate } from '@/utils/shared/localDate';

const CATEGORIES: TripExpenseCategory[] = ['flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other'];

export default function NewTripExpenseScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = useAuthStore((s) => s.session?.user.id ?? null);
  const addTripExpense = useTripsStore((s) => s.addTripExpense);
  const recoveredDraft = useTripsStore((s) => Object.values(s.pendingExpenseDrafts).find((draft) =>
    draft.accountId === accountId && draft.tripId === id && draft.status !== 'confirmed'));
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const danger = useThemeColor({}, 'danger');

  const [name, setName] = useState(recoveredDraft?.name ?? '');
  const [amount, setAmount] = useState(
    recoveredDraft ? minorUnitsToDecimalString(recoveredDraft.amount) : '',
  );
  const [category, setCategory] = useState<TripExpenseCategory>(recoveredDraft?.category ?? 'flight');
  const [transactionDate, setTransactionDate] = useState(recoveredDraft?.transactionDate ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // One draft is one logical expense (APP-059 review #1). Every retry sends this same
  // id, so an attempt that committed but lost its answer cannot become a second
  // Economy expense. Only a confirmed save ends the draft.
  const [expenseId, setExpenseId] = useState(() => recoveredDraft?.expenseId ?? newEntityId());
  const loadedDraftId = useRef(recoveredDraft?.expenseId ?? null);
  const renderedAccountId = useRef(accountId);

  // Hydration and auth may complete after the screen mounts. Load each recovered
  // draft once; subsequent typing remains the user's, never overwritten by persistence.
  useEffect(() => {
    if (renderedAccountId.current !== accountId) {
      renderedAccountId.current = accountId;
      loadedDraftId.current = null;
      setExpenseId(newEntityId());
      setName('');
      setAmount('');
      setCategory('flight');
      setTransactionDate('');
    }
    if (!recoveredDraft || loadedDraftId.current === recoveredDraft.expenseId) return;
    loadedDraftId.current = recoveredDraft.expenseId;
    setExpenseId(recoveredDraft.expenseId);
    setName(recoveredDraft.name);
    setAmount(minorUnitsToDecimalString(recoveredDraft.amount));
    setCategory(recoveredDraft.category);
    setTransactionDate(recoveredDraft.transactionDate);
  }, [accountId, recoveredDraft]);

  const parsedAmount = parseSupportedMoneyInput(amount);
  const canSave = name.trim().length > 0 && parsedAmount.ok && parsedAmount.value >= 0
    && parseCalendarDate(transactionDate) !== null && !isSaving;

  const save = async () => {
    if (!parsedAmount.ok || !canSave) return;
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const saved = await addTripExpense({
        expenseId,
        tripId: id!,
        name: name.trim(),
        amount: parsedAmount.value,
        category,
        transactionDate,
      });
      if (!saved) {
        setSaveFailed(true);
        return;
      }
      router.back();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
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

        <Text style={styles.fieldLabel}>{t('travel.transactionDateLabel')}</Text>
        <DatePickerField value={transactionDate} onChange={setTransactionDate} />
        <Text style={styles.hint}>{t('travel.transactionDateRequiredHint')}</Text>

        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={t(`travel.categories.${c}`)} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </Card>

      {saveFailed && <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.expenseSaveFailed')}</Text>}
      <Button label={isSaving ? t('travel.savingExpense') : t('expenses.save')} disabled={!canSave} onPress={save} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16 },
  card: { gap: 14 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 12, opacity: 0.65 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

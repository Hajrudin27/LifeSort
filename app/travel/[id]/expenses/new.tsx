import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useTripsStore } from '@/store/useTripsStore';
import { TripExpenseCategory } from '@/types/trip';
import { COMMON_CURRENCIES } from '@/utils/trip/currencyConversion';

const CATEGORIES: TripExpenseCategory[] = ['flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other'];

export default function NewTripExpenseScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const addTripExpense = useTripsStore((s) => s.addTripExpense);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<TripExpenseCategory>('flight');
  const [currency, setCurrency] = useState('DKK');
  const [isSaving, setIsSaving] = useState(false);

  const canSave = name.trim().length > 0 && !isNaN(parseFloat(amount)) && !isSaving;

  const save = async () => {
    setIsSaving(true);
    try {
      await addTripExpense({
        tripId: id!,
        name: name.trim(),
        amount: parseFloat(amount),
        category,
        currency: currency !== 'DKK' ? currency : undefined,
      });
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

        <View style={styles.amountRow}>
          <TextInput
            style={[styles.input, styles.amountInput, { borderColor, backgroundColor: surface }]}
            placeholder={t('expenses.amountPlaceholder')}
            placeholderTextColor={borderColor}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <View style={styles.currencyScroll}>
            {COMMON_CURRENCIES.map((c) => (
              <Chip key={c} label={c} active={currency === c} onPress={() => setCurrency(c)} />
            ))}
          </View>
        </View>

        {currency !== 'DKK' && (
          <Text style={{ color: textMuted, fontSize: 12 }}>{t('travel.currencyConversionHint')}</Text>
        )}

        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={t(`travel.categories.${c}`)} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </Card>

      <Button label={isSaving ? t('travel.convertingCurrency') : t('expenses.save')} disabled={!canSave} onPress={save} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16 },
  card: { gap: 14 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14 },
  amountRow: { gap: 10 },
  amountInput: {},
  currencyScroll: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
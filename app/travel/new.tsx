import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useTripsStore } from '@/store/useTripsStore';
import { PackingCategory } from '@/types/trip';
import { todayIso } from '@/utils/shared/localDate';

const DEFAULT_PACKING_ITEMS: { key: string; category: PackingCategory }[] = [
  { key: 'passport', category: 'essentials' },
  { key: 'wallet', category: 'essentials' },
  { key: 'charger', category: 'electronics' },
  { key: 'toothbrush', category: 'toiletries' },
  { key: 'medication', category: 'toiletries' },
];

export default function NewTripScreen() {
  const { t } = useTranslation();
  const addTrip = useTripsStore((s) => s.addTrip);
  const trips = useTripsStore((s) => s.trips);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const today = todayIso();

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [budget, setBudget] = useState('');
  const [copyFromTripId, setCopyFromTripId] = useState<string | null>(null);

  const canSave = name.trim().length > 0;

  const save = () => {
    const defaultItems = DEFAULT_PACKING_ITEMS.map(({ key, category }) => ({
      label: t(`travel.defaultPackingItems.${key}`),
      category,
    }));
    addTrip(
      {
        name: name.trim(),
        startDate,
        endDate,
        budget: budget.trim().length > 0 && !isNaN(parseFloat(budget)) ? parseFloat(budget) : null,
      },
      defaultItems,
      copyFromTripId
    );
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('travel.namePlaceholder')}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />

        <Text style={sharedStyles.fieldLabel}>{t('travel.startDateLabel')}</Text>
        <DatePickerField value={startDate} onChange={setStartDate} />

        <Text style={sharedStyles.fieldLabel}>{t('travel.endDateLabel')}</Text>
        <DatePickerField value={endDate} onChange={setEndDate} />

        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('travel.budgetPlaceholder')}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={budget}
          onChangeText={setBudget}
        />

        {trips.length > 0 && (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('travel.copyPackingFrom')}</Text>
            <View style={sharedStyles.chipRow}>
              <Chip label={t('travel.defaultPackingList')} active={copyFromTripId === null} onPress={() => setCopyFromTripId(null)} />
              {trips.map((tr) => (
                <Chip key={tr.id} label={tr.name} active={copyFromTripId === tr.id} onPress={() => setCopyFromTripId(tr.id)} />
              ))}
            </View>
          </>
        )}
      </Card>

      <Button label={t('travel.save')} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}
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
import { parseSupportedMoneyInput } from '@/core/money/supportedMoney';
import { useTripsStore } from '@/store/useTripsStore';
import { PackingCategory } from '@/types/trip';
import { todayIso } from '@/utils/shared/localDate';
import { MAX_TRIP_DESTINATION_LENGTH, normalizeDestination, tripProblem } from '@/utils/trip/tripDomain';

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
  const danger = useThemeColor({}, 'danger');

  const today = todayIso();

  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [budget, setBudget] = useState('');
  const [copyFromTripId, setCopyFromTripId] = useState<string | null>(null);

  // A new trip names its destination and its dates are calendar dates in order.
  // "Destination required" is said by the field, not by an error on an empty form.
  const problem = tripProblem({ destination, startDate, endDate }, { destinationRequired: true });
  const dateProblem = problem !== null && problem !== 'destination-required' ? problem : null;
  const parsedBudget = budget.trim().length === 0 ? null : parseSupportedMoneyInput(budget);
  const budgetValid = parsedBudget === null || (parsedBudget.ok && parsedBudget.value >= 0);
  const canSave = name.trim().length > 0 && normalizeDestination(destination) !== undefined
    && problem === null && budgetValid;

  const save = () => {
    const defaultItems = DEFAULT_PACKING_ITEMS.map(({ key, category }) => ({
      label: t(`travel.defaultPackingItems.${key}`),
      category,
    }));
    const id = addTrip(
      {
        name: name.trim(),
        destination: destination.trim(),
        startDate,
        endDate,
        budget: parsedBudget?.ok ? parsedBudget.value : null,
      },
      defaultItems,
      copyFromTripId
    );
    if (!id) {
      setSaveFailed(true);
      return;
    }
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

        <Text style={sharedStyles.fieldLabel}>{t('travel.destinationLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('travel.destinationPlaceholder')}
          placeholderTextColor={borderColor}
          accessibilityLabel={t('travel.destinationLabel')}
          maxLength={MAX_TRIP_DESTINATION_LENGTH}
          value={destination}
          onChangeText={setDestination}
        />

        <Text style={sharedStyles.fieldLabel}>{t('travel.startDateLabel')}</Text>
        <DatePickerField value={startDate} onChange={setStartDate} />

        <Text style={sharedStyles.fieldLabel}>{t('travel.endDateLabel')}</Text>
        <DatePickerField value={endDate} onChange={setEndDate} />
        {dateProblem && (
          <Text accessibilityRole="alert" style={{ color: danger }}>{t(`travel.problems.${dateProblem}`)}</Text>
        )}

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

      {saveFailed && <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.saveFailed')}</Text>}
      <Button label={t('travel.save')} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}

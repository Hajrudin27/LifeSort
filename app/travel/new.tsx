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
import {
  getPackingTemplateByKey,
  packingTemplateKey,
  resolvePackingTemplate,
  SELECTABLE_PACKING_TEMPLATES,
} from '@/features/travel/packingTemplates';
import { useTripsStore } from '@/store/useTripsStore';
import { todayIso } from '@/utils/shared/localDate';
import { MAX_TRIP_DESTINATION_LENGTH, normalizeDestination, tripProblem } from '@/utils/trip/tripDomain';

export default function NewTripScreen() {
  const { t } = useTranslation();
  const addTrip = useTripsStore((s) => s.addTrip);
  const trips = useTripsStore((s) => s.trips);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const danger = useThemeColor({}, 'danger');
  const textMuted = useThemeColor({}, 'textMuted');

  const today = todayIso();

  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [budget, setBudget] = useState('');
  const [packingSource, setPackingSource] = useState('empty');

  // A new trip names its destination and its dates are calendar dates in order.
  // "Destination required" is said by the field, not by an error on an empty form.
  const problem = tripProblem({ destination, startDate, endDate }, { destinationRequired: true });
  const dateProblem = problem !== null && problem !== 'destination-required' ? problem : null;
  const parsedBudget = budget.trim().length === 0 ? null : parseSupportedMoneyInput(budget);
  const budgetValid = parsedBudget === null || (parsedBudget.ok && parsedBudget.value >= 0);
  const canSave = name.trim().length > 0 && normalizeDestination(destination) !== undefined
    && problem === null && budgetValid;

  const save = () => {
    const selectedTemplate = packingSource.startsWith('template:')
      ? getPackingTemplateByKey(packingSource.slice('template:'.length))
      : null;
    const copiedTemplateItems = selectedTemplate
      ? resolvePackingTemplate(selectedTemplate, t).items.map(({ label, category }) => ({ label, category }))
      : [];
    const copyFromTripId = packingSource.startsWith('trip:')
      ? packingSource.slice('trip:'.length)
      : null;
    const id = addTrip(
      {
        name: name.trim(),
        destination: destination.trim(),
        startDate,
        endDate,
        budget: parsedBudget?.ok ? parsedBudget.value : null,
      },
      copiedTemplateItems,
      copyFromTripId,
      selectedTemplate ? { id: selectedTemplate.id, version: selectedTemplate.version } : null,
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

        <Text style={sharedStyles.fieldLabel}>{t('travel.packingStartWith')}</Text>
        <Text style={{ color: textMuted }}>{t('travel.packingCopyHint')}</Text>
        <View style={sharedStyles.chipRow}>
          <Chip label={t('travel.packingStartEmpty')} active={packingSource === 'empty'} onPress={() => setPackingSource('empty')} />
          {SELECTABLE_PACKING_TEMPLATES.map((entry) => {
            const key = packingTemplateKey(entry);
            return (
              <Chip
                key={key}
                label={t('travel.packingTemplateLabel', {
                  title: t(`travel.packingTemplates.titles.${entry.titleKey}`),
                  version: entry.version,
                })}
                active={packingSource === `template:${key}`}
                onPress={() => setPackingSource(`template:${key}`)}
              />
            );
          })}
          {trips.map((tr) => (
            <Chip
              key={tr.id}
              label={t('travel.packingTripCopyLabel', { name: tr.name })}
              active={packingSource === `trip:${tr.id}`}
              onPress={() => setPackingSource(`trip:${tr.id}`)}
            />
          ))}
        </View>
      </Card>

      {saveFailed && <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.saveFailed')}</Text>}
      <Button label={t('travel.save')} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}

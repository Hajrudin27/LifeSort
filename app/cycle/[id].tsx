import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';

export default function EditCycleScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backgroundColor = useThemeColor({}, 'background');

  const cycle = useCycleStore((s) => s.cycles.find((c) => c.id === id));
  const updateCycle = useCycleStore((s) => s.updateCycle);
  const removeCycle = useCycleStore((s) => s.removeCycle);

  const [startDate, setStartDate] = useState(cycle?.startDate ?? '');
  const [endDate, setEndDate] = useState(cycle?.endDate ?? '');
  const [hasEndDate, setHasEndDate] = useState(!!cycle?.endDate);

  if (!cycle) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('cycle.emptyHistory')}</Text>
      </View>
    );
  }

  const save = () => {
    updateCycle(cycle.id, { startDate, endDate: hasEndDate ? endDate : undefined });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t('cycle.deleteConfirmTitle'), t('cycle.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('cycle.delete'), style: 'destructive', onPress: () => { removeCycle(cycle.id); router.back(); } },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Stack.Screen options={{ title: t('cycle.editCycleTitle') }} />
      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t('cycle.startDateLabel')}</Text>
        <DatePickerField value={startDate} onChange={setStartDate} />

        <Text style={sharedStyles.fieldLabel}>{t('cycle.endDateLabel')}</Text>
        <DatePickerField value={endDate || startDate} onChange={(d) => { setEndDate(d); setHasEndDate(true); }} />
      </Card>

      <Button label={t('cycle.save')} onPress={save} />
      <Button label={t('cycle.delete')} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}
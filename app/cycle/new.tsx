import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';
import { todayIso } from '@/utils/shared/localDate';

function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && startB <= endA;
}

export default function NewPastCycleScreen() {
  const { t } = useTranslation();
  const backgroundColor = useThemeColor({}, 'background');

  const startPeriod = useCycleStore((s) => s.startPeriod);
  const endPeriod = useCycleStore((s) => s.endPeriod);
  const cycles = useCycleStore((s) => s.cycles);

  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [hasEndDate, setHasEndDate] = useState(true);

  const createCycle = () => {
    const beforeIds = new Set(cycles.map((c) => c.id));
    startPeriod(startDate);
    // Find det nyoprettede id ved at sammenligne før/efter — samme mønster
    // som andre steder, hvor vi har brug for det friskt oprettede objekt.
    const afterCycles = useCycleStore.getState().cycles;
    const created = afterCycles.find((c) => !beforeIds.has(c.id));
    if (created && hasEndDate) {
      endPeriod(created.id, endDate);
    }
    router.back();
  };

  const save = () => {
    const effectiveEndDate = hasEndDate ? endDate : startDate;
    const hasOverlap = cycles.some((c) => {
      const cEnd = c.endDate ?? c.startDate;
      return rangesOverlap(startDate, effectiveEndDate, c.startDate, cEnd);
    });

    if (hasOverlap) {
      Alert.alert(t('cycle.overlapWarningTitle'), t('cycle.overlapWarningMessage'), [
        { text: t('warranties.cancel'), style: 'cancel' },
        { text: t('cycle.overlapContinueButton'), onPress: createCycle },
      ]);
      return;
    }

    createCycle();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('cycle.addPastCycleTitle') }} />
      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t('cycle.startDateLabel')}</Text>
        <DatePickerField value={startDate} onChange={setStartDate} />

        <View style={sharedStyles.chipRow}>
          <Chip label={t('cycle.endDateLabel')} active={hasEndDate} onPress={() => setHasEndDate(!hasEndDate)} />
        </View>

        {hasEndDate && (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('cycle.endDateLabel')}</Text>
            <DatePickerField value={endDate} onChange={setEndDate} />
          </>
        )}
      </Card>

      <Button label={t('cycle.save')} onPress={save} />
    </ScrollView>
  );
}
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';
import { FlowIntensity, Symptom } from '@/types/cycle';

const SYMPTOMS: Symptom[] = [
  'cramps', 'headache', 'bloating', 'fatigue', 'moodSwings', 'acne', 'backache', 'nausea', 'tenderBreasts', 'other',
];
const FLOWS: FlowIntensity[] = ['spotting', 'light', 'medium', 'heavy'];

export default function LogAnotherDayScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const symptomLogs = useCycleStore((s) => s.symptomLogs);
  const logSymptoms = useCycleStore((s) => s.logSymptoms);

  const todayIso = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(todayIso);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [flow, setFlow] = useState<FlowIntensity | undefined>(undefined);
  const [notes, setNotes] = useState('');

  const onDateChange = (newDate: string) => {
    setDate(newDate);
    const existing = symptomLogs.find((l) => l.date === newDate);
    setSymptoms(existing?.symptoms ?? []);
    setFlow(existing?.flow);
    setNotes(existing?.notes ?? '');
  };

  const toggleSymptom = (s: Symptom) => {
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const save = () => {
    logSymptoms(date, symptoms, flow, notes.trim() || undefined);
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('cycle.logAnotherDayLabel') }} />

      <View style={[styles.kicker, { backgroundColor: cycleTints.accentSoft }]}>
        <SymbolView name={{ ios: 'calendar.badge.plus', android: 'event_note', web: 'event_note' }} size={12} tintColor={cycleTints.accent} />
        <Text style={[styles.kickerText, { color: cycleTints.accent }]}>{t('cycle.selectDateLabel')}</Text>
      </View>
      <DatePickerField value={date} onChange={onDateChange} />

      <Card style={[sharedStyles.card, styles.section, { borderColor: cycleTints.accentSoft }]}>
        <Text style={sharedStyles.fieldLabel}>{t('cycle.flowLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {FLOWS.map((f) => (
            <Chip key={f} label={t(`cycle.flow.${f}`)} active={flow === f} onPress={() => setFlow(flow === f ? undefined : f)} />
          ))}
        </View>

        <Text style={sharedStyles.fieldLabel}>{t('cycle.symptomsTodayLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {SYMPTOMS.map((s) => (
            <Chip key={s} label={t(`cycle.symptoms.${s}`)} active={symptoms.includes(s)} onPress={() => toggleSymptom(s)} />
          ))}
        </View>

        <Text style={sharedStyles.fieldLabel}>{t('cycle.notesLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, styles.notesInput, { borderColor, backgroundColor: surface }]}
          placeholder={t('cycle.notesPlaceholder')}
          placeholderTextColor={borderColor}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </Card>

      <Button label={t('cycle.save')} onPress={save} />
    </ScrollView>
  );
}

const styles = {
  kicker: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, alignSelf: 'flex-start' as const, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 6 },
  kickerText: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  section: { borderWidth: 1.5, marginTop: 4 },
  notesInput: { minHeight: 60, textAlignVertical: 'top' as const },
};
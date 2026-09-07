import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCVStore } from '@/store/useCVStore';
import { todayIso } from '@/utils/shared/localDate';

export default function EditExperienceScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const entry = useCVStore((s) => s.experience.find((e) => e.id === id));
  const updateExperience = useCVStore((s) => s.updateExperience);
  const removeExperience = useCVStore((s) => s.removeExperience);

  const [company, setCompany] = useState(entry?.company ?? '');
  const [position, setPosition] = useState(entry?.position ?? '');
  const [startDate, setStartDate] = useState(entry ? `${entry.startDate}-01` : '');
  const [endDate, setEndDate] = useState(entry?.endDate ? `${entry.endDate}-01` : todayIso());
  const [isCurrent, setIsCurrent] = useState(!entry?.endDate);
  const [description, setDescription] = useState(entry?.description ?? '');

  if (!entry) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('cv.emptyExperience')}</Text>
      </View>
    );
  }

  const canSave = company.trim().length > 0 && position.trim().length > 0;

  const save = () => {
    updateExperience(entry.id, {
      company: company.trim(),
      position: position.trim(),
      startDate: startDate.slice(0, 7),
      endDate: isCurrent ? undefined : endDate.slice(0, 7),
      description: description.trim() || undefined,
    });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t('cv.deleteConfirmTitle'), t('cv.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('cv.delete'), style: 'destructive', onPress: () => { removeExperience(entry.id); router.back(); } },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: entry.position }} />
      <Card style={sharedStyles.card}>
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} value={company} onChangeText={setCompany} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} value={position} onChangeText={setPosition} />

        <Text style={sharedStyles.fieldLabel}>{t('cv.startDateLabel')}</Text>
        <DatePickerField value={startDate} onChange={setStartDate} />

        <View style={sharedStyles.chipRow}>
          <Chip label={t('cv.currentToggle')} active={isCurrent} onPress={() => setIsCurrent(!isCurrent)} />
        </View>

        {!isCurrent && (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('cv.endDateLabel')}</Text>
            <DatePickerField value={endDate} onChange={setEndDate} />
          </>
        )}

        <TextInput
          style={[sharedStyles.input, styles.descInput, { borderColor, backgroundColor: surface }]}
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </Card>

      <Button label={t('cv.save')} disabled={!canSave} onPress={save} />
      <Button label={t('cv.delete')} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = { descInput: { minHeight: 80, textAlignVertical: 'top' as const } };
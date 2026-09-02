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

export default function EditEducationScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const entry = useCVStore((s) => s.education.find((e) => e.id === id));
  const updateEducation = useCVStore((s) => s.updateEducation);
  const removeEducation = useCVStore((s) => s.removeEducation);

  const [school, setSchool] = useState(entry?.school ?? '');
  const [degree, setDegree] = useState(entry?.degree ?? '');
  const [fieldOfStudy, setFieldOfStudy] = useState(entry?.fieldOfStudy ?? '');
  const [startDate, setStartDate] = useState(entry ? `${entry.startDate}-01` : '');
  const [endDate, setEndDate] = useState(entry?.endDate ? `${entry.endDate}-01` : new Date().toISOString().split('T')[0]);
  const [isCurrent, setIsCurrent] = useState(!entry?.endDate);
  const [description, setDescription] = useState(entry?.description ?? '');

  if (!entry) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('cv.emptyEducation')}</Text>
      </View>
    );
  }

  const canSave = school.trim().length > 0 && degree.trim().length > 0;

  const save = () => {
    updateEducation(entry.id, {
      school: school.trim(),
      degree: degree.trim(),
      fieldOfStudy: fieldOfStudy.trim() || undefined,
      startDate: startDate.slice(0, 7),
      endDate: isCurrent ? undefined : endDate.slice(0, 7),
      description: description.trim() || undefined,
    });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t('cv.deleteConfirmTitle'), t('cv.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('cv.delete'), style: 'destructive', onPress: () => { removeEducation(entry.id); router.back(); } },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: entry.degree }} />
      <Card style={sharedStyles.card}>
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} value={school} onChangeText={setSchool} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} value={degree} onChangeText={setDegree} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} value={fieldOfStudy} onChangeText={setFieldOfStudy} />

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
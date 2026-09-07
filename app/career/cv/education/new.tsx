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
import { useCVStore } from '@/store/useCVStore';
import { todayIso } from '@/utils/shared/localDate';

export default function NewEducationScreen() {
  const { t } = useTranslation();
  const addEducation = useCVStore((s) => s.addEducation);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const [school, setSchool] = useState('');
  const [degree, setDegree] = useState('');
  const [fieldOfStudy, setFieldOfStudy] = useState('');
  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [isCurrent, setIsCurrent] = useState(false);
  const [description, setDescription] = useState('');

  const canSave = school.trim().length > 0 && degree.trim().length > 0;

  const save = () => {
    addEducation({
      school: school.trim(),
      degree: degree.trim(),
      fieldOfStudy: fieldOfStudy.trim() || undefined,
      startDate: startDate.slice(0, 7),
      endDate: isCurrent ? undefined : endDate.slice(0, 7),
      description: description.trim() || undefined,
    });
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.schoolPlaceholder')} placeholderTextColor={borderColor} value={school} onChangeText={setSchool} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.degreePlaceholder')} placeholderTextColor={borderColor} value={degree} onChangeText={setDegree} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.fieldOfStudyPlaceholder')} placeholderTextColor={borderColor} value={fieldOfStudy} onChangeText={setFieldOfStudy} />

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
          placeholder={t('cv.descriptionPlaceholder')}
          placeholderTextColor={borderColor}
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </Card>

      <Button label={t('cv.save')} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}

const styles = { descInput: { minHeight: 80, textAlignVertical: 'top' as const } };
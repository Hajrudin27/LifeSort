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

export default function NewExperienceScreen() {
  const { t } = useTranslation();
  const addExperience = useCVStore((s) => s.addExperience);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const todayIso = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [isCurrent, setIsCurrent] = useState(false);
  const [description, setDescription] = useState('');

  const canSave = company.trim().length > 0 && position.trim().length > 0;

  const save = () => {
    addExperience({
      company: company.trim(),
      position: position.trim(),
      startDate: startDate.slice(0, 7),
      endDate: isCurrent ? undefined : endDate.slice(0, 7),
      description: description.trim() || undefined,
    });
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.companyPlaceholder')} placeholderTextColor={borderColor} value={company} onChangeText={setCompany} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.positionPlaceholder')} placeholderTextColor={borderColor} value={position} onChangeText={setPosition} />

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
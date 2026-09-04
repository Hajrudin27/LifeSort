import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useProfileStore } from '@/store/useProfileStore';
import { useToastStore } from '@/store/useToastStore';
import { Gender } from '@/types/profile';

const GENDERS: Gender[] = ['female', 'male', 'other', 'unspecified'];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const profile = useProfileStore((s) => s.profile);
  const setName = useProfileStore((s) => s.setName);
  const setAge = useProfileStore((s) => s.setAge);
  const setGender = useProfileStore((s) => s.setGender);
  const setPartnerName = useProfileStore((s) => s.setPartnerName);
  const showToast = useToastStore((s) => s.show);

  const [name, setLocalName] = useState(profile.name ?? '');
  const [age, setLocalAge] = useState(profile.age?.toString() ?? '');
  const [gender, setLocalGender] = useState<Gender>(profile.gender);
  const [partnerName, setLocalPartnerName] = useState(profile.partnerName ?? '');
  const [error, setError] = useState<string | null>(null);

  const parsedAge = parseInt(age, 10);
  const canSave = name.trim().length > 0 && !isNaN(parsedAge) && parsedAge > 0;

  const save = () => {
    if (name.trim().length === 0) {
      setError(t('profile.nameRequiredError'));
      return;
    }
    if (isNaN(parsedAge) || parsedAge <= 0) {
      setError(t('profile.ageRequiredError'));
      return;
    }
    setError(null);
    setName(name);
    setAge(parsedAge);
    setGender(gender);
    setPartnerName(partnerName);
    showToast(t('common.saved'));
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t('profile.nameLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('profile.namePlaceholder')}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setLocalName}
        />

        <Text style={sharedStyles.fieldLabel}>{t('profile.ageLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('profile.agePlaceholder')}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          value={age}
          onChangeText={setLocalAge}
        />

        <Text style={sharedStyles.fieldLabel}>{t('profile.genderLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {GENDERS.map((g) => (
            <Chip key={g} label={t(`profile.gender.${g}`)} active={gender === g} onPress={() => setLocalGender(g)} />
          ))}
        </View>
        <Text style={[styles.hint, { color: textMuted }]}>{t('profile.genderHint')}</Text>

        {error && <Text style={{ color: danger, fontSize: 13 }}>{error}</Text>}
      </Card>

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t('profile.partnerNameLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('profile.partnerNamePlaceholder')}
          placeholderTextColor={borderColor}
          value={partnerName}
          onChangeText={setLocalPartnerName}
        />
        <Text style={[styles.hint, { color: textMuted }]}>{t('profile.partnerNameHint')}</Text>
      </Card>

      <Button label={t('profile.save')} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}

const styles = {
  hint: { fontSize: 12 },
};
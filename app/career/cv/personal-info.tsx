import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCVStore } from '@/store/useCVStore';

export default function PersonalInfoScreen() {
  const { t } = useTranslation();
  const info = useCVStore((s) => s.personalInfo);
  const updatePersonalInfo = useCVStore((s) => s.updatePersonalInfo);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const [fullName, setFullName] = useState(info.fullName ?? '');
  const [jobTitle, setJobTitle] = useState(info.jobTitle ?? '');
  const [email, setEmail] = useState(info.email ?? '');
  const [phone, setPhone] = useState(info.phone ?? '');
  const [location, setLocation] = useState(info.location ?? '');
  const [linkedin, setLinkedin] = useState(info.linkedin ?? '');
  const [website, setWebsite] = useState(info.website ?? '');
  const [summary, setSummary] = useState(info.summary ?? '');

  const canSave = fullName.trim().length > 0;

  const save = () => {
    updatePersonalInfo({
      fullName: fullName.trim(),
      jobTitle: jobTitle.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      location: location.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      website: website.trim() || undefined,
      summary: summary.trim() || undefined,
    });
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.fullNamePlaceholder')} placeholderTextColor={borderColor} value={fullName} onChangeText={setFullName} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.jobTitlePlaceholder')} placeholderTextColor={borderColor} value={jobTitle} onChangeText={setJobTitle} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.emailPlaceholder')} placeholderTextColor={borderColor} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.phonePlaceholder')} placeholderTextColor={borderColor} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.locationPlaceholder')} placeholderTextColor={borderColor} value={location} onChangeText={setLocation} />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.linkedinPlaceholder')} placeholderTextColor={borderColor} value={linkedin} onChangeText={setLinkedin} autoCapitalize="none" />
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.websitePlaceholder')} placeholderTextColor={borderColor} value={website} onChangeText={setWebsite} autoCapitalize="none" />
        <TextInput
          style={[sharedStyles.input, styles.summaryInput, { borderColor, backgroundColor: surface }]}
          placeholder={t('cv.summaryPlaceholder')}
          placeholderTextColor={borderColor}
          value={summary}
          onChangeText={setSummary}
          multiline
        />
      </Card>

      <Button label={t('cv.save')} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}

const styles = {
  summaryInput: { minHeight: 90, textAlignVertical: 'top' as const },
};
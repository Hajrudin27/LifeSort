import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCVStore } from '@/store/useCVStore';
import { useCareerStore } from '@/store/useCareerStore';

export default function CvHubScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');

  const personalInfo = useCVStore((s) => s.personalInfo);
  const education = useCVStore((s) => s.education);
  const experience = useCVStore((s) => s.experience);
  const languages = useCVStore((s) => s.languages);
  const skills = useCareerStore((s) => s.skills);

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" onPress={() => router.push('/career/cv/personal-info')}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('cv.personalInfoLabel')}</Text>
          <Text style={{ color: textMuted }}>{personalInfo.fullName ? '✓' : ''}</Text>
        </Card>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push('/career/cv/experience')}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('cv.experienceLabel')}</Text>
          <Text style={{ color: textMuted }}>{experience.length}</Text>
        </Card>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push('/career/cv/education')}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('cv.educationLabel')}</Text>
          <Text style={{ color: textMuted }}>{education.length}</Text>
        </Card>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push('/career/cv/languages')}>
        <Card style={sharedStyles.rowBetween}>
          <Text style={styles.linkText}>{t('cv.languagesLabel')}</Text>
          <Text style={{ color: textMuted }}>{languages.length}</Text>
        </Card>
      </Pressable>

      <Card>
        <Text style={[styles.skillsHint, { color: textMuted }]}>
          {t('cv.skillsPreviewLabel')}: {skills.length}
        </Text>
      </Card>

      <Button label={t('cv.selectionTitle')} onPress={() => router.push('/career/cv/generate')} />
    </ScrollView>
  );
}

const styles = {
  linkText: { fontWeight: '700' as const },
  skillsHint: { fontSize: 13 },
};
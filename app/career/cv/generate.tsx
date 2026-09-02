import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import CollapsibleSection from '@/components/CollapsibleSection';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCVStore } from '@/store/useCVStore';
import { useCareerStore } from '@/store/useCareerStore';
import { CvTheme } from '@/types/cv';
import { buildCvHtml } from '@/utils/cv/cvPdfTemplate';
import { buildFilteredCvData, CvSelectionIds } from '@/utils/cv/cvSelection';
import { CV_THEME_LIST, CV_THEMES } from '@/utils/cv/cvThemes';
import { previewCvPdf } from '@/utils/cv/generateCvPdf';

export default function GenerateCvScreen() {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const tint = useThemeColor({}, 'tint');
  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';

  const personalInfo = useCVStore((s) => s.personalInfo);
  const education = useCVStore((s) => s.education);
  const experience = useCVStore((s) => s.experience);
  const languages = useCVStore((s) => s.languages);
  const skills = useCareerStore((s) => s.skills);
  const versions = useCVStore((s) => s.versions);
  const addVersion = useCVStore((s) => s.addVersion);
  const removeVersion = useCVStore((s) => s.removeVersion);

  const [experienceIds, setExperienceIds] = useState<string[]>(experience.map((e) => e.id));
  const [educationIds, setEducationIds] = useState<string[]>(education.map((e) => e.id));
  const [languageIds, setLanguageIds] = useState<string[]>(languages.map((l) => l.id));
  const [skillIds, setSkillIds] = useState<string[]>(skills.map((s) => s.id));
  const [theme, setTheme] = useState<CvTheme>('terracotta');
  const [versionName, setVersionName] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(false);

  const toggle = (list: string[], id: string, setter: (v: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const currentSelection: CvSelectionIds = { experienceIds, educationIds, languageIds, skillIds };

  const runPreview = async (selection: CvSelectionIds, selectedTheme: CvTheme) => {
    if (!personalInfo.fullName || personalInfo.fullName.trim().length === 0) {
      Alert.alert('', t('cv.missingNameWarning'));
      return;
    }
    setIsPreviewing(true);
    try {
      const filtered = buildFilteredCvData(selection, { experience, education, languages, skills }, t);
      const html = buildCvHtml({
        personalInfo,
        education: filtered.education,
        experience: filtered.experience,
        languages: filtered.languages,
        skillsByCategory: filtered.skillsByCategory,
        locale,
        theme: CV_THEMES[selectedTheme],
        labels: {
          currentLabel: t('cv.current'),
          experienceTitle: t('cv.experienceLabel'),
          educationTitle: t('cv.educationLabel'),
          skillsTitle: t('cv.skillsPreviewLabel'),
          languagesTitle: t('cv.languagesLabel'),
          proficiency: {
            basic: t('cv.proficiency.basic'),
            conversational: t('cv.proficiency.conversational'),
            fluent: t('cv.proficiency.fluent'),
            native: t('cv.proficiency.native'),
          },
        },
      });
      await previewCvPdf(html);
    } finally {
      setIsPreviewing(false);
    }
  };

  const saveVersion = () => {
    if (versionName.trim().length === 0) return;
    addVersion({ name: versionName.trim(), theme, ...currentSelection });
    setVersionName('');
  };

  const confirmDeleteVersion = (id: string) => {
    Alert.alert(t('cv.deleteVersionConfirmTitle'), t('cv.deleteVersionConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('warranties.delete'), style: 'destructive', onPress: () => removeVersion(id) },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('cv.selectionTitle') }} />

      {versions.length > 0 && (
        <>
          <Text style={sharedStyles.sectionLabel}>{t('cv.savedVersionsLabel')}</Text>
          {versions.map((v) => (
            <Pressable key={v.id} onLongPress={() => confirmDeleteVersion(v.id)}>
              <Card style={sharedStyles.rowBetween}>
                <View style={styles.versionInfo}>
                  <Text style={styles.versionName}>{v.name}</Text>
                  <Text style={{ color: textMuted, fontSize: 12 }}>{t(`cv.theme.${v.theme}`)}</Text>
                </View>
                <Pressable
                  onPress={() =>
                    runPreview(
                      { experienceIds: v.experienceIds, educationIds: v.educationIds, languageIds: v.languageIds, skillIds: v.skillIds },
                      v.theme
                    )
                  }>
                  <SymbolView name={{ ios: 'eye', android: 'visibility', web: 'visibility' }} size={22} tintColor={tint} />
                </Pressable>
              </Card>
            </Pressable>
          ))}
        </>
      )}

      <Text style={sharedStyles.sectionLabel}>{t('cv.newSelectionLabel')}</Text>

      <Text style={sharedStyles.fieldLabel}>{t('cv.themeLabel')}</Text>
      <View style={sharedStyles.chipRow}>
        {CV_THEME_LIST.map((th) => (
          <Chip key={th} label={t(`cv.theme.${th}`)} active={theme === th} onPress={() => setTheme(th)} />
        ))}
      </View>

      {experience.length > 0 && (
        <CollapsibleSection title={t('cv.includeExperienceLabel')} defaultOpen>
          <View style={sharedStyles.chipRow}>
            {experience.map((e) => (
              <Chip
                key={e.id}
                label={`${e.position} · ${e.company}`}
                active={experienceIds.includes(e.id)}
                onPress={() => toggle(experienceIds, e.id, setExperienceIds)}
              />
            ))}
          </View>
        </CollapsibleSection>
      )}

      {education.length > 0 && (
        <CollapsibleSection title={t('cv.includeEducationLabel')} defaultOpen>
          <View style={sharedStyles.chipRow}>
            {education.map((e) => (
              <Chip
                key={e.id}
                label={e.degree}
                active={educationIds.includes(e.id)}
                onPress={() => toggle(educationIds, e.id, setEducationIds)}
              />
            ))}
          </View>
        </CollapsibleSection>
      )}

      {languages.length > 0 && (
        <CollapsibleSection title={t('cv.includeLanguagesLabel')}>
          <View style={sharedStyles.chipRow}>
            {languages.map((l) => (
              <Chip
                key={l.id}
                label={l.name}
                active={languageIds.includes(l.id)}
                onPress={() => toggle(languageIds, l.id, setLanguageIds)}
              />
            ))}
          </View>
        </CollapsibleSection>
      )}

      {skills.length > 0 && (
        <CollapsibleSection title={t('cv.includeSkillsLabel')}>
          <View style={sharedStyles.chipRow}>
            {skills.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                active={skillIds.includes(s.id)}
                onPress={() => toggle(skillIds, s.id, setSkillIds)}
              />
            ))}
          </View>
        </CollapsibleSection>
      )}

      <Button
        label={isPreviewing ? t('cv.generating') : t('cv.previewAndShare')}
        disabled={isPreviewing}
        onPress={() => runPreview(currentSelection, theme)}
      />

      <Text style={sharedStyles.sectionLabel}>{t('cv.saveVersionLabel')}</Text>
      <Card style={styles.saveRow}>
        <TextInput
          style={[sharedStyles.input, styles.versionInput, { borderColor, backgroundColor: surface }]}
          placeholder={t('cv.versionNamePlaceholder')}
          placeholderTextColor={borderColor}
          value={versionName}
          onChangeText={setVersionName}
        />
        <Button label={t('cv.saveVersion')} disabled={versionName.trim().length === 0} onPress={saveVersion} />
      </Card>
    </ScrollView>
  );
}

const styles = {
  versionInfo: { flex: 1 },
  versionName: { fontWeight: '700' as const },
  saveRow: { gap: 10 },
  versionInput: {},
};
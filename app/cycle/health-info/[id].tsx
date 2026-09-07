import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import Card from '@/components/Card';
import HealthDisclaimer from '@/components/HealthDisclaimer';
import Kicker from '@/components/Kicker';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';
import { getConditionIconName } from '@/utils/cycle/healthConditionIcon';

export default function HealthConditionDetailScreen() {
  const { t, i18n } = useTranslation();
  const isDa = i18n.language === 'da';
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const condition = useCycleStore((s) => s.healthConditions.find((c) => c.id === id));
  const symptomGlossary = useCycleStore((s) => s.symptomGlossary);

  if (!condition) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('healthInfo.title')}</Text>
      </View>
    );
  }

  const commonSymptomNames = condition.commonSymptoms
    .map((symptomId) => symptomGlossary.find((s) => s.id === symptomId))
    .filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Stack.Screen options={{ title: isDa ? condition.nameDa : condition.nameEn }} />

      <HealthDisclaimer />

      <View style={styles.iconHeader}>
        <View style={[styles.bigIconGlow, { backgroundColor: cycleTints.accentSoft }]} />
        <View style={[styles.bigIconCircle, { backgroundColor: cycleTints.accent }]}>
          <SymbolView name={getConditionIconName(condition.id) as any} size={30} tintColor="#FFFFFF" />
        </View>
        <Text style={styles.conditionName}>{isDa ? condition.nameDa : condition.nameEn}</Text>
      </View>

      <Kicker
        label={t('healthInfo.whatItIsLabel')}
        color={cycleTints.accent}
        backgroundColor={cycleTints.accentSoft}
        style={styles.sectionKickerSpacing}
      />
      <Card style={[styles.sectionCard, { borderColor: cycleTints.accentSoft }]}>
        <Text style={styles.body}>{isDa ? condition.whatItIsDa : condition.whatItIsEn}</Text>
      </Card>

      {commonSymptomNames.length > 0 && (
        <>
          <Kicker
            label={t('healthInfo.commonSymptomsLabel')}
            color={cycleTints.accent}
            backgroundColor={cycleTints.accentSoft}
            style={styles.sectionKickerSpacing}
          />
          <View style={sharedStyles.chipRow}>
            {commonSymptomNames.map((s) => (
              <View key={s.id} style={[styles.symptomChip, { borderColor: cycleTints.accent, backgroundColor: cycleTints.accentSoft }]}>
                <Text style={{ color: cycleTints.accent, fontSize: 13, fontWeight: '700' }}>{isDa ? s.nameDa : s.nameEn}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Kicker
        label={t('healthInfo.whatHelpsLabel')}
        color={cycleTints.accent}
        backgroundColor={cycleTints.accentSoft}
        style={styles.sectionKickerSpacing}
      />
      <Card style={[styles.sectionCard, { borderColor: cycleTints.accentSoft }]}>
        <Text style={styles.body}>{isDa ? condition.whatHelpsDa : condition.whatHelpsEn}</Text>
      </Card>

      <Kicker
        label={t('healthInfo.whenToSeeDoctorLabel')}
        color={cycleTints.accent}
        backgroundColor={cycleTints.accentSoft}
        style={styles.sectionKickerSpacing}
      />
      <Card style={[styles.sectionCard, { borderColor: cycleTints.accentSoft }]}>
        <Text style={styles.body}>{isDa ? condition.whenToSeeDoctorDa : condition.whenToSeeDoctorEn}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = {
  sectionKickerSpacing: { marginBottom: 4 },
  iconHeader: { alignItems: 'center' as const, marginVertical: 8, position: 'relative' as const },
  bigIconGlow: { position: 'absolute' as const, width: 96, height: 96, borderRadius: 48, top: -8 },
  bigIconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  conditionName: { fontSize: 18, fontWeight: '800' as const, marginTop: 10, textAlign: 'center' as const },
  sectionCard: { borderWidth: 1.5 },
  body: { lineHeight: 20 },
  symptomChip: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
};
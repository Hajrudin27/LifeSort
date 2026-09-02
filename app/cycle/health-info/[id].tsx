import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import Card from '@/components/Card';
import HealthDisclaimer from '@/components/HealthDisclaimer';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { HEALTH_CONDITIONS } from '@/data/healthConditions';
import { getConditionIconName } from '@/utils/cycle/healthConditionIcon';

export default function HealthConditionDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const condition = HEALTH_CONDITIONS.find((c) => c.id === id);

  if (!condition) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('healthInfo.title')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Stack.Screen options={{ title: t(condition.nameKey) }} />

      <HealthDisclaimer />

      <View style={styles.iconHeader}>
        <View style={[styles.bigIconGlow, { backgroundColor: cycleTints.accentSoft }]} />
        <View style={[styles.bigIconCircle, { backgroundColor: cycleTints.accent }]}>
          <SymbolView name={getConditionIconName(condition.id) as any} size={30} tintColor="#FFFFFF" />
        </View>
        <Text style={styles.conditionName}>{t(condition.nameKey)}</Text>
      </View>

      <View style={[styles.sectionKicker, { backgroundColor: cycleTints.accentSoft }]}>
        <Text style={[styles.sectionKickerText, { color: cycleTints.accent }]}>{t('healthInfo.whatItIsLabel')}</Text>
      </View>
      <Card style={[styles.sectionCard, { borderColor: cycleTints.accentSoft }]}>
        <Text style={styles.body}>{t(condition.whatItIsKey)}</Text>
      </Card>

      {condition.commonSymptomsKeys.length > 0 && (
        <>
          <View style={[styles.sectionKicker, { backgroundColor: cycleTints.accentSoft }]}>
            <Text style={[styles.sectionKickerText, { color: cycleTints.accent }]}>{t('healthInfo.commonSymptomsLabel')}</Text>
          </View>
          <View style={sharedStyles.chipRow}>
            {condition.commonSymptomsKeys.map((s) => (
              <View key={s} style={[styles.symptomChip, { borderColor: cycleTints.accent, backgroundColor: cycleTints.accentSoft }]}>
                <Text style={{ color: cycleTints.accent, fontSize: 13, fontWeight: '700' }}>{t(`cycle.symptoms.${s}`)}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={[styles.sectionKicker, { backgroundColor: cycleTints.accentSoft }]}>
        <Text style={[styles.sectionKickerText, { color: cycleTints.accent }]}>{t('healthInfo.whatHelpsLabel')}</Text>
      </View>
      <Card style={[styles.sectionCard, { borderColor: cycleTints.accentSoft }]}>
        <Text style={styles.body}>{t(condition.whatHelpsKey)}</Text>
      </Card>

      <View style={[styles.sectionKicker, { backgroundColor: cycleTints.accentSoft }]}>
        <Text style={[styles.sectionKickerText, { color: cycleTints.accent }]}>{t('healthInfo.whenToSeeDoctorLabel')}</Text>
      </View>
      <Card style={[styles.sectionCard, { borderColor: cycleTints.accentSoft }]}>
        <Text style={styles.body}>{t(condition.whenToSeeDoctorKey)}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = {
  iconHeader: { alignItems: 'center' as const, marginVertical: 8, position: 'relative' as const },
  bigIconGlow: { position: 'absolute' as const, width: 96, height: 96, borderRadius: 48, top: -8 },
  bigIconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  conditionName: { fontSize: 18, fontWeight: '800' as const, marginTop: 10, textAlign: 'center' as const },
  sectionKicker: { alignSelf: 'flex-start' as const, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12, marginBottom: 4 },
  sectionKickerText: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  sectionCard: { borderWidth: 1.5 },
  body: { lineHeight: 20 },
  symptomChip: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
};
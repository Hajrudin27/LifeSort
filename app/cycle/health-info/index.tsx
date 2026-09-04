import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput } from 'react-native';

import Card from '@/components/Card';
import Chip from '@/components/Chip';
import HealthDisclaimer from '@/components/HealthDisclaimer';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';
import { getConditionIconName } from '@/utils/cycle/healthConditionIcon';

export default function HealthInfoScreen() {
  const { t, i18n } = useTranslation();
  const isDa = i18n.language === 'da';
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');

  const conditions = useCycleStore((s) => s.healthConditions);
  const symptoms = useCycleStore((s) => s.symptomGlossary);

  const [tab, setTab] = useState<'conditions' | 'symptoms'>('conditions');
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const filteredConditions = conditions.filter((c) => (isDa ? c.nameDa : c.nameEn).toLowerCase().includes(query));
  const filteredSymptoms = symptoms.filter((s) => (isDa ? s.nameDa : s.nameEn).toLowerCase().includes(query));

  return (
    <ScrollView style={{}} contentContainerStyle={styles.container}>
      <HealthDisclaimer />

      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t('healthInfo.searchPlaceholder')}
        placeholderTextColor={borderColor}
        value={search}
        onChangeText={setSearch}
      />

      <View style={sharedStyles.chipRow}>
        <Chip label={t('healthInfo.conditionsTab')} active={tab === 'conditions'} onPress={() => setTab('conditions')} />
        <Chip label={t('healthInfo.symptomsTab')} active={tab === 'symptoms'} onPress={() => setTab('symptoms')} />
      </View>

      {conditions.length === 0 && symptoms.length === 0 ? (
        <Text style={{ color: textMuted, textAlign: 'center', marginTop: 24 }}>{t('healthInfo.emptyState')}</Text>
      ) : tab === 'conditions' ? (
        <View style={sharedStyles.list}>
          {filteredConditions.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/cycle/health-info/${c.id}`)}>
              <Card style={[styles.conditionCard, { borderColor: cycleTints.accentSoft }]}>
                <View style={[styles.conditionIcon, { backgroundColor: cycleTints.accent }]}>
                  <SymbolView name={getConditionIconName(c.id) as any} size={18} tintColor="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{isDa ? c.nameDa : c.nameEn}</Text>
                  <Text style={{ color: textMuted, fontSize: 13, marginTop: 2 }}>{isDa ? c.summaryDa : c.summaryEn}</Text>
                </View>
                <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={14} tintColor={textMuted} />
              </Card>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={sharedStyles.list}>
          {filteredSymptoms.map((s) => {
            const relatedConditions = conditions.filter((c) => c.commonSymptoms.includes(s.id));
            return (
              <Card key={s.id} style={[styles.symptomCard, { borderColor: cycleTints.accentSoft }]}>
                <Text style={styles.name}>{isDa ? s.nameDa : s.nameEn}</Text>
                <Text style={{ color: textMuted, fontSize: 13, marginTop: 2 }}>{isDa ? s.descriptionDa : s.descriptionEn}</Text>
                {relatedConditions.length > 0 && (
                  <>
                    <Text style={[styles.relatedLabel, { color: cycleTints.accent }]}>{t('healthInfo.relatedConditionsLabel')}</Text>
                    <View style={sharedStyles.chipRow}>
                      {relatedConditions.map((c) => (
                        <Pressable key={c.id} onPress={() => router.push(`/cycle/health-info/${c.id}`)}>
                          <View style={[styles.relatedChip, { backgroundColor: cycleTints.accentSoft, borderColor: cycleTints.accent }]}>
                            <Text style={[styles.relatedChipText, { color: cycleTints.accent }]}>{isDa ? c.nameDa : c.nameEn}</Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = {
  container: { padding: 16, gap: 14, paddingBottom: 48 },
  name: { fontWeight: '800' as const, fontSize: 16 },
  conditionCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, borderWidth: 1.5 },
  conditionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center' as const, justifyContent: 'center' as const },
  symptomCard: { borderWidth: 1.5 },
  relatedLabel: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, marginTop: 10, marginBottom: 5, letterSpacing: 0.4 },
  relatedChip: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12 },
  relatedChipText: { fontSize: 12, fontWeight: '700' as const },
};
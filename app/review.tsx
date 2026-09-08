import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import {
  type MonthlyFact,
  previousMonthKey,
} from '@/core/modules/monthlyReview';
import { getModule } from '@/core/modules/moduleRegistry';
import { isModuleEnabled } from '@/core/modules/moduleEnablement';
import { MONTHLY_REVIEW_PROVIDERS } from '@/features/monthlyReview';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { useReviewStore } from '@/store/useReviewStore';

/**
 * Månedligt tilbageblik (APP-016).
 *
 * Siden viser kendsgerninger, ikke en vurdering. Der står hvor mange gøremål
 * der blev klaret — ikke om det var mange nok.
 */
export default function MonthlyReviewScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');

  const enablement = useEnabledModulesStore((s) => s.enablement);
  const showOnHome = useReviewStore((s) => s.showOnHome);
  const setShowOnHome = useReviewStore((s) => s.setShowOnHome);

  const monthKey = previousMonthKey(new Date());
  const monthLabel = new Intl.DateTimeFormat(i18n.language === 'da' ? 'da-DK' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${monthKey}-01T12:00:00`));

  const [facts, setFacts] = useState<MonthlyFact[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const collect = async () => {
      const contributing = (Object.keys(MONTHLY_REVIEW_PROVIDERS) as (keyof typeof MONTHLY_REVIEW_PROVIDERS)[])
        .filter((moduleId) => isModuleEnabled(moduleId, enablement));

      const results = await Promise.all(
        contributing.map(async (moduleId) => {
          try {
            return await MONTHLY_REVIEW_PROVIDERS[moduleId]!(monthKey);
          } catch {
            // Ét modul, der fejler, må ikke koste hele tilbageblikket.
            return [];
          }
        }),
      );

      if (!cancelled) setFacts(results.flat());
    };

    collect();
    return () => {
      cancelled = true;
    };
  }, [enablement, monthKey]);

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={styles.content}>
      <Text style={styles.month}>{monthLabel}</Text>
      <Text style={[styles.subtitle, { color: textMuted }]}>{t('review.subtitle')}</Text>

      {facts !== null && facts.length === 0 && (
        <Card>
          <Text style={styles.emptyTitle}>{t('review.emptyTitle', { month: monthLabel })}</Text>
          <Text style={[styles.emptyBody, { color: textMuted }]}>{t('review.emptyBody')}</Text>
        </Card>
      )}

      {facts !== null && facts.length > 0 && (
        <>
          <Card style={styles.factCard}>
            {facts.map((fact, index) => (
              <View key={`${fact.moduleId}-${fact.labelKey}-${index}`} style={styles.factRow}>
                <Text style={[styles.factModule, { color: textMuted }]}>{t(getModule(fact.moduleId).titleKey)}</Text>
                <Text style={styles.factText}>{t(fact.labelKey, fact.params)}</Text>
              </View>
            ))}
          </Card>

          {/* Siger hvor tallene kommer fra. Et tilbageblik, der ikke kan
              efterprøves, er en påstand. */}
          <Text style={[styles.note, { color: textMuted }]}>{t('review.factsNote')}</Text>
        </>
      )}

      <Card style={styles.optOut}>
        <View style={styles.optOutText}>
          <Text style={styles.optOutLabel}>{t('review.showOnHomeLabel')}</Text>
          <Text style={[styles.optOutHint, { color: textMuted }]}>{t('review.showOnHomeHint')}</Text>
        </View>
        <Switch
          value={showOnHome}
          onValueChange={setShowOnHome}
          accessibilityRole="switch"
          accessibilityLabel={t('review.showOnHomeLabel')}
          accessibilityState={{ checked: showOnHome }}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  month: { fontSize: 22, fontWeight: '800', textTransform: 'capitalize' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  factCard: { gap: 0 },
  factRow: { paddingVertical: 10, gap: 2 },
  factModule: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  factText: { fontSize: 15, lineHeight: 21 },
  note: { fontSize: 12, lineHeight: 17 },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  optOut: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  optOutText: { flex: 1, gap: 2 },
  optOutLabel: { fontSize: 15, fontWeight: '600' },
  optOutHint: { fontSize: 12, lineHeight: 17 },
});

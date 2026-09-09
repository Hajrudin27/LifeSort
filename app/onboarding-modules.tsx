import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import ModuleChoiceList from '@/components/ModuleChoiceList';
import { Text, useThemeColor } from '@/components/Themed';
import { useProfileStore } from '@/store/useProfileStore';

/**
 * Onboardingens egentlige spørgsmål (APP-020).
 *
 * "Hvad skal LifeSort hjælpe dig med?" er mere værd end noget demografisk felt.
 * Tidligere blev cyklus-modulet udledt af køn; nu spørger vi, og svaret er
 * brugerens eget — og kan ændres igen når som helst i Indstillinger.
 *
 * Alt er slået til fra start. Onboarding er en anledning til at fravælge, ikke
 * en port man skal forcere: en tom app er en dårligere start end en fuld.
 */
export default function OnboardingModulesScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');
  const tint = useThemeColor({}, 'tint');

  const markOnboarded = useProfileStore((s) => s.markOnboarded);

  const done = () => {
    // Onboarding er fuldført, fordi brugeren siger det — ikke fordi et bestemt
    // felt blev udfyldt (APP-017).
    markOnboarded();
    // `dismissTo`, ikke `replace`: replace bytter kun det øverste punkt i
    // stakken ud, så alt under onboarding-skærmen blev liggende — appen kom
    // frem, men onboarding lå der stadig, og man kunne komme tilbage til den.
    // dismissTo lukker alt ned til appen selv og efterlader intet af flowet.
    router.dismissTo('/(tabs)');
  };

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: tint }]}>{t('modules.chooseTitle')}</Text>
      <Text style={[styles.subtitle, { color: textMuted }]}>{t('modules.chooseSubtitle')}</Text>

      <ModuleChoiceList />

      <Text style={[styles.note, { color: textMuted }]}>{t('modules.dataKeptNote')}</Text>

      <Button label={t('profile.onboardingSaveButton')} onPress={done} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 15, lineHeight: 21 },
  note: { fontSize: 13, lineHeight: 19 },
});

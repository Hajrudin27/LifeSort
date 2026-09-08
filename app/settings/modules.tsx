import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import ModuleChoiceList from '@/components/ModuleChoiceList';
import { Text, useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';

/**
 * "Mine moduler" (APP-010).
 *
 * Listen kommer fra registret, ikke fra en håndholdt liste her — et nyt modul
 * dukker op af sig selv. Skallen og kontoen står ikke på listen: de kan ikke
 * fravælges.
 */

export default function ModulesSettingsScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Text style={[styles.intro, { color: textMuted }]}>{t('modules.chooseSubtitle')}</Text>

      <ModuleChoiceList />

      {/* Det vigtigste på skærmen: at slå fra er ikke at slette. Uden den
          sætning ser en kontakt ud som en risiko, og så tør folk ikke bruge den. */}
      <Text style={[styles.note, { color: textMuted }]}>{t('modules.dataKeptNote')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, lineHeight: 21, marginBottom: 16 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 16 },
});

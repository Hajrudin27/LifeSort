import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { useModuleAccess } from '@/core/feature-flags/useModuleAccess';
import { TOGGLEABLE_MODULE_IDS } from '@/core/modules/moduleEnablement';
import { getModule, type ModuleId } from '@/core/modules/moduleRegistry';
import { sharedStyles } from '@/constants/sharedStyles';
import { useModuleEnabled } from '@/core/modules/useModuleEnabled';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';

/**
 * "Mine moduler" (APP-010).
 *
 * Listen kommer fra registret, ikke fra en håndholdt liste her — et nyt modul
 * dukker op af sig selv. Skallen og kontoen står ikke på listen: de kan ikke
 * fravælges.
 */

function ModuleRow({ moduleId }: { moduleId: ModuleId }) {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');

  const definition = getModule(moduleId);
  const enabled = useModuleEnabled(moduleId);
  const access = useModuleAccess(moduleId);
  const setModuleEnabled = useEnabledModulesStore((s) => s.setModuleEnabled);

  const title = t(definition.titleKey);

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={[styles.rowHint, { color: textMuted }]}>{t(definition.descriptionKey)}</Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={(next) => setModuleEnabled(moduleId, next)}
        // Et modul der er lukket ned af en kill switch, kan ikke slås til —
        // men kontakten viser stadig brugerens eget valg, så det ikke ser ud
        // som om hun har fravalgt noget, hun ikke har.
        disabled={!access.canOpenModule}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: enabled, disabled: !access.canOpenModule }}
        accessibilityHint={enabled ? t('modules.enabledLabel') : t('modules.disabledLabel')}
      />
    </View>
  );
}

export default function ModulesSettingsScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Text style={[styles.intro, { color: textMuted }]}>{t('modules.chooseSubtitle')}</Text>

      <Card>
        {TOGGLEABLE_MODULE_IDS.map((moduleId) => (
          <ModuleRow key={moduleId} moduleId={moduleId} />
        ))}
      </Card>

      {/* Det vigtigste på skærmen: at slå fra er ikke at slette. Uden den
          sætning ser en kontakt ud som en risiko, og så tør folk ikke bruge den. */}
      <Text style={[styles.note, { color: textMuted }]}>{t('modules.dataKeptNote')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, lineHeight: 21, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowHint: { fontSize: 13, lineHeight: 18 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 16 },
});

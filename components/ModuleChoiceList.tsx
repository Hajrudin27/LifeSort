import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { useModuleAccess } from '@/core/feature-flags/useModuleAccess';
import { TOGGLEABLE_MODULE_IDS } from '@/core/modules/moduleEnablement';
import { getModule, type ModuleId } from '@/core/modules/moduleRegistry';
import { useModuleEnabled } from '@/core/modules/useModuleEnabled';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';

/**
 * Listen over moduler, brugeren kan slå til og fra.
 *
 * Deles af onboarding (APP-020) og Indstillinger (APP-010), så det er præcis
 * samme liste og samme ordvalg begge steder — og så et nyt modul kun skal
 * beskrives ét sted.
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
        // Et modul lukket ned af en kill switch kan ikke slås til, men
        // kontakten viser stadig brugerens eget valg.
        disabled={!access.canOpenModule}
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: enabled, disabled: !access.canOpenModule }}
        accessibilityHint={enabled ? t('modules.enabledLabel') : t('modules.disabledLabel')}
      />
    </View>
  );
}

export default function ModuleChoiceList() {
  return (
    <Card>
      {TOGGLEABLE_MODULE_IDS.map((moduleId) => (
        <ModuleRow key={moduleId} moduleId={moduleId} />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowHint: { fontSize: 13, lineHeight: 18 },
});

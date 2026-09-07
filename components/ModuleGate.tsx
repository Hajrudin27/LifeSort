import { router, usePathname } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useModuleAccess } from '@/core/feature-flags/useModuleAccess';
import { type ModuleAccessStatus } from '@/core/modules/moduleAvailability';
import { isWriteRoute, moduleForPath } from '@/core/modules/moduleRoutes';

/**
 * Den sikre landing, når et modul er slået fra (APP-006).
 *
 * Ligger som overlay oven på ruten frem for at omdirigere: brugeren bliver stående
 * hvor hun er, navigationshistorikken består, og der er ingen risiko for en
 * omdirigerings-løkke, hvis to skærme skulle være spærret på samme tid.
 *
 * Tonen er vigtig. Et lukket modul ligner tabt data, hvis man ikke siger andet —
 * derfor står der på hver eneste variant, at dataene er der endnu, og hvor de
 * kan hentes ud.
 */

const COPY: Record<Exclude<ModuleAccessStatus, 'active'>, { title: string; body: string }> = {
  maintenance: { title: 'modules.maintenanceTitle', body: 'modules.maintenanceBody' },
  retired: { title: 'modules.retiredTitle', body: 'modules.retiredBody' },
  unreleased: { title: 'modules.unreleasedTitle', body: 'modules.unreleasedBody' },
  'internal-only': { title: 'modules.internalOnlyTitle', body: 'modules.internalOnlyBody' },
  'beta-only': { title: 'modules.betaOnlyTitle', body: 'modules.betaOnlyBody' },
};

export default function ModuleGate() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const access = useModuleAccess(moduleForPath(pathname));

  const backgroundColor = useThemeColor({}, 'background');
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const text = useThemeColor({}, 'text');

  // Et modul i maintenance er åbent for læsning, men tager ikke imod nyt: så
  // spærres opret- og rette-skærmene, mens resten af modulet står åbent.
  const blocked = !access.canOpenModule || (!access.canCreate && isWriteRoute(pathname));

  // Langt det almindeligste. Ingen overlay, intet ekstra lag.
  if (!blocked) return null;

  // 'active' kan i praksis ikke være spærret, men typen udelukker det ikke —
  // og en overlay uden tekst ville være værre end en generisk. Falder tilbage.
  const copy = access.status === 'active'
    ? { title: 'modules.unavailableTitle', body: 'modules.unavailableBody' }
    : COPY[access.status];

  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel={t(copy.title)}
      style={[styles.container, { backgroundColor }]}
    >
      <View style={[styles.iconCircle, { backgroundColor: surface, borderColor }]}>
        <SymbolView name="wrench.and.screwdriver" size={30} tintColor={textMuted} />
      </View>

      <Text style={styles.title}>{t(copy.title)}</Text>
      <Text style={[styles.body, { color: textMuted }]}>{t(copy.body)}</Text>

      {/* Datarettigheden er ikke bare sand i koden — den skal også stå her, hvor
          brugeren møder den lukkede dør. */}
      <Text style={[styles.note, { color: textMuted }]}>{t('modules.dataSafeNote')}</Text>

      {router.canGoBack() && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('modules.backButton')}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { borderColor, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={{ color: text, fontWeight: '600' }}>{t('modules.backButton')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    zIndex: 998,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  note: { fontSize: 13, textAlign: 'center', marginTop: 4 },
  backButton: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
});

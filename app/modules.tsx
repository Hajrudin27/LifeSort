import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useModuleFlagsStore } from '@/store/useModuleFlagsStore';
import { resolveModuleAvailability } from '@/core/feature-flags/moduleFlags';
import { rankModuleIds } from '@/core/modules/homeRanking';
import { evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import { TOGGLEABLE_MODULE_IDS } from '@/core/modules/moduleEnablement';
import { getModule, type ModuleId } from '@/core/modules/moduleRegistry';
import { matchesModuleQuery } from '@/core/modules/moduleSearch';
import { useModuleEnabled } from '@/core/modules/useModuleEnabled';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { useHomeLayoutStore } from '@/store/useHomeLayoutStore';

/**
 * Modul-launcheren (APP-015).
 *
 * Alternativet til at gøre hvert modul til et tab. Tabs skal være få og
 * stabile; her er der plads til dem alle, og listen kommer fra registret, så et
 * nyt modul dukker op af sig selv.
 *
 * Kun moduler brugeren har valgt til OG som er udgivet. Et modul lukket ned af
 * en kill switch står ikke og lokker med en dør, der ikke kan åbnes.
 */

const MODULE_ICONS: Record<string, { ios: string; android: string; web: string }> = {
  economy: { ios: 'banknote', android: 'payments', web: 'payments' },
  food: { ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' },
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  goals: { ios: 'flag.fill', android: 'flag', web: 'flag' },
  habits: { ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' },
  tasks: { ios: 'checklist', android: 'checklist', web: 'checklist' },
  travel: { ios: 'airplane', android: 'flight', web: 'flight' },
  warranties: { ios: 'shield.lefthalf.filled', android: 'shield', web: 'shield' },
  career: { ios: 'briefcase.fill', android: 'work', web: 'work' },
  cycle: { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' },
  default: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' },
};

const MODULE_ROUTES: Record<string, string> = {
  economy: '/economy',
  food: '/food',
  home: '/household',
  goals: '/life-goals',
  habits: '/habits',
  tasks: '/todos',
  travel: '/travel',
  warranties: '/warranties',
  career: '/career',
  cycle: '/cycle',
};

function ModuleRow({ moduleId }: { moduleId: ModuleId }) {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');

  const definition = getModule(moduleId);
  const pinned = useHomeLayoutStore((s) => s.pinned).includes(moduleId);
  const togglePinned = useHomeLayoutStore((s) => s.togglePinned);

  const title = t(definition.titleKey);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pinned ? `${title} — ${t('modules.launcherPinnedBadge')}` : title}
      accessibilityHint={t(definition.descriptionKey)}
      // Fastgør er også en tilgængeligheds-handling: et langt tryk findes ikke
      // for en skærmlæser.
      accessibilityActions={[
        { name: 'pin', label: pinned ? t('modules.launcherUnpinAction') : t('modules.launcherPinAction') },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'pin') togglePinned(moduleId);
      }}
      onPress={() => router.push(MODULE_ROUTES[moduleId] as never)}
      onLongPress={() => togglePinned(moduleId)}
      style={[styles.row, { borderColor }]}
    >
      <View style={[styles.iconCircle, { backgroundColor: `${tint}18` }]}>
        <SymbolView name={(MODULE_ICONS[moduleId] ?? MODULE_ICONS.default) as any} size={18} tintColor={tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={[styles.rowHint, { color: textMuted }]}>{t(definition.descriptionKey)}</Text>
      </View>
      {pinned && (
        <SymbolView name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' } as any} size={14} tintColor={tint} />
      )}
    </Pressable>
  );
}

export default function ModuleLauncherScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const backgroundColor = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');

  const [query, setQuery] = useState('');

  const enablement = useEnabledModulesStore((s) => s.enablement);
  const overrides = useModuleFlagsStore((s) => s.overrides);
  const pinned = useHomeLayoutStore((s) => s.pinned);
  const hidden = useHomeLayoutStore((s) => s.hidden);
  const lastOpenedAt = useHomeLayoutStore((s) => s.lastOpenedAt);

  const active = TOGGLEABLE_MODULE_IDS.filter((moduleId) => {
    if (enablement[moduleId] === false) return false;
    return evaluateModuleAccess(resolveModuleAvailability(moduleId, overrides)).showInNavigation;
  });

  const ordered = rankModuleIds(active, { pinned, hidden, lastOpenedAt });
  const matching = ordered.filter((moduleId) =>
    matchesModuleQuery([t(getModule(moduleId).titleKey), t(getModule(moduleId).descriptionKey)], query),
  );

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.subtitle, { color: textMuted }]}>{t('modules.launcherSubtitle')}</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('modules.launcherSearchPlaceholder')}
        placeholderTextColor={textMuted}
        accessibilityLabel={t('modules.launcherSearchPlaceholder')}
        clearButtonMode="while-editing"
        style={[styles.search, { borderColor, backgroundColor: surface, color: textMuted }]}
      />

      {active.length === 0 && <Text style={[styles.empty, { color: textMuted }]}>{t('modules.launcherEmpty')}</Text>}

      {active.length > 0 && matching.length === 0 && (
        <Text style={[styles.empty, { color: textMuted }]}>{t('modules.launcherNoMatches', { query })}</Text>
      )}

      <Card style={styles.list}>
        {matching.map((moduleId) => (
          <ModuleRow key={moduleId} moduleId={moduleId} />
        ))}
      </Card>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings/modules')}
        style={[styles.manage, { borderColor }]}
      >
        <Text style={{ fontWeight: '600' }}>{t('modules.launcherManage')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  search: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 15 },
  list: { gap: 0, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 44 },
  iconCircle: { width: 36, height: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowHint: { fontSize: 13, lineHeight: 18 },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 8 },
  manage: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    marginTop: 4,
  },
});

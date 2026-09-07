import Constants from 'expo-constants';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import Hero, { HeroBadge, HeroBadgeText } from '@/components/Hero';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type IconName = { ios: string; android: string; web: string };

// Hvert punkt her beskriver noget appen faktisk gør — se PrivacyOverlay.tsx,
// utils/auth/secureSessionStorage.ts og useAppLockStore.ts.
const DATA_POINTS: { key: string; icon: IconName }[] = [
  { key: 'onDevice', icon: { ios: 'iphone', android: 'smartphone', web: 'smartphone' } },
  { key: 'backup', icon: { ios: 'checkmark.icloud.fill', android: 'cloud_done', web: 'cloud_done' } },
  { key: 'keychain', icon: { ios: 'key.fill', android: 'key', web: 'key' } },
  { key: 'appSwitcher', icon: { ios: 'eye.slash.fill', android: 'visibility_off', web: 'visibility_off' } },
  { key: 'appLock', icon: { ios: 'lock.fill', android: 'lock', web: 'lock' } },
];

export default function AboutScreen() {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const backgroundColor = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const borderColor = useThemeColor({}, 'border');
  const textMuted = useThemeColor({}, 'textMuted');

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView
      style={[styles.root, { backgroundColor }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <Hero
        variant="brand"
        icon={{ ios: 'square.grid.2x2.fill', android: 'grid_view', web: 'grid_view' }}
        kicker={t('about.kicker')}
        title={t('about.appName')}
        subtitle={t('about.tagline')}
        trailing={
          <HeroBadge>
            <HeroBadgeText>{t('about.versionBadge', { version })}</HeroBadgeText>
          </HeroBadge>
        }
      />

      <View style={styles.section}>
        <Text style={[styles.sectionEyebrow, { color: accentTints.accent }]}>{t('about.dataEyebrow')}</Text>
        <Text style={styles.sectionTitle}>{t('about.dataTitle')}</Text>
        <Text style={[styles.sectionIntro, { color: textMuted }]}>{t('about.dataIntro')}</Text>
      </View>

      <View style={styles.list}>
        {DATA_POINTS.map((point) => (
          <Card key={point.key} style={styles.pointCard}>
            <View style={[styles.pointIcon, { backgroundColor: accentTints.accentSoft }]}>
              <SymbolView name={point.icon as any} size={17} tintColor={accentTints.accent} />
            </View>
            <View style={styles.pointText}>
              <Text style={styles.pointTitle}>{t(`about.points.${point.key}.title`)}</Text>
              <Text style={[styles.pointBody, { color: textMuted }]}>
                {t(`about.points.${point.key}.body`)}
              </Text>
            </View>
          </Card>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        style={[styles.settingsLink, { backgroundColor: surface, borderColor }]}
        onPress={() => router.dismissTo('/(tabs)/settings')}>
        <SymbolView
          name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
          size={17}
          tintColor={accentTints.accent}
        />
        <View style={styles.pointText}>
          <Text style={styles.pointTitle}>{t('about.settingsLinkTitle')}</Text>
          <Text style={[styles.pointBody, { color: textMuted }]}>{t('about.settingsLinkBody')}</Text>
        </View>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={16}
          tintColor={textMuted}
        />
      </Pressable>

      <Text style={[styles.colophon, { color: textMuted }]}>{t('about.colophon', { version })}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  section: { gap: 4, backgroundColor: 'transparent' },
  sectionEyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  sectionIntro: { fontSize: 13, lineHeight: 19 },
  list: { gap: 10, backgroundColor: 'transparent' },
  pointCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pointIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { flex: 1, gap: 3, backgroundColor: 'transparent' },
  pointTitle: { fontSize: 14, fontWeight: '800' },
  pointBody: { fontSize: 12.5, lineHeight: 18 },
  settingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  colophon: { fontSize: 11.5, textAlign: 'center', marginTop: 4 },
});

import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { shouldRecommendAppLock } from '@/core/auth/appLockPolicy';
import { useEnabledModuleIds } from '@/core/modules/useModuleEnabled';
import { useAppLockStore } from '@/store/useAppLockStore';
import { hasPin } from '@/utils/auth/pinAuth';

/**
 * Forslaget om at slå app-låsen til (APP-026).
 *
 * Vises kun, når der faktisk er noget at beskytte — et modul med helbredsdata —
 * og låsen er slået fra. Forslaget kan afvises, og så kommer det ikke igen i
 * den her session: en påmindelse, der bliver ved, er en, folk lærer at klikke
 * væk uden at læse.
 */
export default function AppLockSuggestion() {
  const { t } = useTranslation();
  const warning = useThemeColor({}, 'warning');
  const textMuted = useThemeColor({}, 'textMuted');

  const lockEnabled = useAppLockStore((s) => s.lockEnabled);
  const setLockEnabled = useAppLockStore((s) => s.setLockEnabled);
  const enabledModuleIds = useEnabledModuleIds();

  const [dismissed, setDismissed] = useState(false);

  if (!shouldRecommendAppLock({ lockEnabled, enabledModuleIds, dismissed })) return null;

  const enable = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false;

    // Uden biometri skal der være en kode, ellers ville låsen være en dør uden
    // nøgle. Så send brugeren hen for at lave en først.
    if (!isEnrolled && !(await hasPin())) {
      router.push('/settings/pin');
      return;
    }

    if (!isEnrolled) {
      Alert.alert(t('appLock.noHardwareTitle'), t('appLock.noHardwareMessage'));
    }
    setLockEnabled(true);
    setDismissed(true);
  };

  return (
    <Card style={[styles.card, { borderColor: warning }]}>
      <Text style={styles.title}>{t('appLock.recommendTitle')}</Text>
      <Text style={[styles.body, { color: textMuted }]}>{t('appLock.recommendBody')}</Text>

      {/* Grænsen står med, også her: låsen dækker telefonen, ikke kontoen. */}
      <Text style={[styles.note, { color: textMuted }]}>{t('appLock.serverNote')}</Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('appLock.recommendEnable')}
          onPress={enable}
          style={[styles.button, { borderColor: warning }]}
        >
          <Text style={styles.buttonText}>{t('appLock.recommendEnable')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('appLock.recommendDismiss')}
          onPress={() => setDismissed(true)}
          style={styles.button}
        >
          <Text style={[styles.buttonText, { color: textMuted }]}>{t('appLock.recommendDismiss')}</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, gap: 6 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, backgroundColor: 'transparent' },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
});

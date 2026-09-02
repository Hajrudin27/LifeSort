import * as LocalAuthentication from 'expo-local-authentication';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useAppLockStore } from '@/store/useAppLockStore';
import { verifyPin } from '@/utils/auth/pinAuth';

export default function LockScreen() {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const backgroundColor = useThemeColor({}, 'background');
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const unlock = useAppLockStore((s) => s.unlock);

  const [showPinInput, setShowPinInput] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const attemptBiometric = async () => {
    setPinError(null);
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      // Ingen biometri tilgængelig på enheden — gå direkte til PIN-indtastning.
      setShowPinInput(true);
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('appLock.biometricPrompt'),
      fallbackLabel: t('appLock.usePinFallback'),
    });

    if (result.success) {
      unlock();
    } else {
      // Brugeren annullerede, eller biometri fejlede — tilbyd PIN som fallback.
      setShowPinInput(true);
    }
  };

  useEffect(() => {
    attemptBiometric();
  }, []);

  const submitPin = async (pinToVerify: string) => {
    setIsChecking(true);
    const isValid = await verifyPin(pinToVerify);
    setIsChecking(false);

    if (isValid) {
      setPin('');
      setPinError(null);
      unlock();
    } else {
      setPinError(t('appLock.wrongPinError'));
      setPin('');
    }
  };

  // Bekræft automatisk, så snart der er indtastet præcis 4 cifre —
  // brugeren skal ikke trykke "Lås op" manuelt hver gang.
  useEffect(() => {
    if (pin.length === 4 && !isChecking) {
      submitPin(pin);
    }
  }, [pin]);

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={[styles.iconCircle, { backgroundColor: accentTints.accentSoft }]}>
        <SymbolView name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }} size={32} tintColor={accentTints.accent} />
      </View>

      <Text style={styles.title}>{t('appLock.lockedTitle')}</Text>

      {!showPinInput ? (
        <Pressable style={[styles.retryButton, { borderColor: accentTints.accent }]} onPress={attemptBiometric}>
          <Text style={[styles.retryText, { color: accentTints.accent }]}>{t('appLock.tryBiometricAgain')}</Text>
        </Pressable>
      ) : (
        <View style={styles.pinSection}>
          <Text style={[styles.pinLabel, { color: textMuted }]}>{t('appLock.enterPinLabel')}</Text>
          <TextInput
            style={[styles.pinInput, { borderColor, backgroundColor: surface }]}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            value={pin}
            onChangeText={setPin}
            autoFocus
            editable={!isChecking}
          />
          {pinError && <Text style={{ color: danger, fontSize: 13 }}>{pinError}</Text>}

          <Pressable onPress={attemptBiometric}>
            <Text style={[styles.switchBack, { color: accentTints.accent }]}>{t('appLock.tryBiometricAgain')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = {
    container: {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        padding: 24,
        gap: 16,
        zIndex: 999,
      },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  title: { fontSize: 20, fontWeight: '800' as const },
  retryButton: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24, marginTop: 8 },
  retryText: { fontWeight: '700' as const },
  pinSection: { width: '100%' as const, maxWidth: 280, alignItems: 'center' as const, gap: 10, marginTop: 8 },
  pinLabel: { fontSize: 13 },
  pinInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 20,
    textAlign: 'center' as const,
    letterSpacing: 8,
    width: '100%' as const,
  },
  switchBack: { fontSize: 13, fontWeight: '600' as const, marginTop: 4 },
};
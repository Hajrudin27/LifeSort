import * as LocalAuthentication from 'expo-local-authentication';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useAppLockStore } from '@/store/useAppLockStore';
import { verifyPin } from '@/utils/auth/pinAuth';
import {
  FREE_ATTEMPTS,
  getLockoutStatus,
  registerFailedAttempt,
  resetLockout,
  type LockoutStatus,
} from '@/utils/auth/pinLockout';

const PIN_LENGTH = 4;
const COUNTDOWN_TICK_MS = 1000;

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

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
  const [lockout, setLockout] = useState<LockoutStatus | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  const isLockedOut = remainingMs > 0;

  const attemptBiometric = useCallback(async () => {
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
      // Biometri er et selvstændigt, stærkt bevis på at det er den rigtige bruger,
      // og operativsystemet har sin egen begrænsning på antal forsøg. En godkendt
      // scanning ophæver derfor spærretiden på PIN-koden.
      await resetLockout();
      setRemainingMs(0);
      setLockout(null);
      unlock();
    } else {
      // Brugeren annullerede, eller biometri fejlede — tilbyd PIN som fallback.
      setShowPinInput(true);
    }
  }, [t, unlock]);

  // Hent en evt. spærring fra tidligere forsøg, før der gøres noget andet —
  // den overlever både app-genstart og at appen fjernes fra baggrunden.
  //
  // Opstarten må køre præcis én gang pr. visning af låseskærmen. Uden vagten
  // ville et sprogskifte (som ændrer `t` og dermed `attemptBiometric`) og
  // StrictMode i udvikling udløse en ekstra Face ID-prompt oven i den første.
  const hasRunStartup = useRef(false);
  useEffect(() => {
    if (hasRunStartup.current) return;
    hasRunStartup.current = true;

    let cancelled = false;
    (async () => {
      const status = await getLockoutStatus();
      if (cancelled) return;
      setLockout(status);
      setRemainingMs(status.remainingMs);
      if (status.locked) {
        setShowPinInput(true);
      } else {
        attemptBiometric();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptBiometric]);

  // Nedtælling mens spærringen løber.
  useEffect(() => {
    if (remainingMs <= 0) return;
    const startedAt = Date.now();
    const initial = remainingMs;
    const interval = setInterval(() => {
      const next = Math.max(0, initial - (Date.now() - startedAt));
      setRemainingMs(next);
      if (next === 0) {
        setPinError(null);
        clearInterval(interval);
      }
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
    // Bevidst kun afhængig af om spærringen er aktiv: intervallet skal startes,
    // når nedtællingen begynder, og ikke genstartes for hvert tik.
  }, [isLockedOut]);

  const submitPin = async (pinToVerify: string) => {
    if (isLockedOut) return;

    setIsChecking(true);
    const isValid = await verifyPin(pinToVerify);

    if (isValid) {
      await resetLockout();
      setIsChecking(false);
      setPin('');
      setPinError(null);
      setLockout(null);
      setRemainingMs(0);
      unlock();
      return;
    }

    const status = await registerFailedAttempt();
    setIsChecking(false);
    setLockout(status);
    setRemainingMs(status.remainingMs);
    setPin('');
    setPinError(status.locked ? null : t('appLock.wrongPinError'));
  };

  // Bekræft automatisk, så snart der er indtastet præcis 4 cifre —
  // brugeren skal ikke trykke "Lås op" manuelt hver gang.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && !isChecking && !isLockedOut) {
      submitPin(pin);
    }
  }, [pin]);

  const attemptsLeft = lockout ? FREE_ATTEMPTS - lockout.failedAttempts : FREE_ATTEMPTS;
  const showAttemptWarning = !isLockedOut && pinError !== null && attemptsLeft > 0 && attemptsLeft <= 2;

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={[styles.iconCircle, { backgroundColor: accentTints.accentSoft }]}>
        <SymbolView name={{ ios: 'lock.fill', android: 'lock', web: 'lock' }} size={32} tintColor={accentTints.accent} />
      </View>

      <Text style={styles.title}>{t('appLock.lockedTitle')}</Text>

      {!showPinInput ? (
        <Pressable accessibilityRole="button" style={[styles.retryButton, { borderColor: accentTints.accent }]} onPress={attemptBiometric}>
          <Text style={[styles.retryText, { color: accentTints.accent }]}>{t('appLock.tryBiometricAgain')}</Text>
        </Pressable>
      ) : (
        <View style={styles.pinSection}>
          <Text style={[styles.pinLabel, { color: textMuted }]}>{t('appLock.enterPinLabel')}</Text>
          <TextInput
            style={[
              styles.pinInput,
              { borderColor, backgroundColor: surface },
              isLockedOut && styles.pinInputDisabled,
            ]}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_LENGTH}
            value={pin}
            onChangeText={setPin}
            autoFocus
            editable={!isChecking && !isLockedOut}
          />

          {isLockedOut && (
            <Text style={[styles.lockoutText, { color: danger }]}>
              {t('appLock.lockedOutMessage', { time: formatRemaining(remainingMs) })}
            </Text>
          )}

          {pinError && <Text style={{ color: danger, fontSize: 13 }}>{pinError}</Text>}

          {showAttemptWarning && (
            <Text style={{ color: textMuted, fontSize: 12 }}>
              {t('appLock.attemptsBeforeLockout', { count: attemptsLeft })}
            </Text>
          )}

          <Pressable accessibilityRole="button" onPress={attemptBiometric}>
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
  pinInputDisabled: { opacity: 0.5 },
  lockoutText: { fontSize: 13, fontWeight: '700' as const, textAlign: 'center' as const },
  switchBack: { fontSize: 13, fontWeight: '600' as const, marginTop: 4 },
};

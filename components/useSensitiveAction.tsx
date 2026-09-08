import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { markVerified, requiresReauthNow } from '@/core/auth/reauth';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';
import { hasPin, verifyPin } from '@/utils/auth/pinAuth';

/**
 * Kør en følsom handling, men bed om et bevis først (APP-024).
 *
 *   const { run, prompt } = useSensitiveAction();
 *   ...
 *   <Button onPress={() => run(exportEverything)} />
 *   {prompt}
 *
 * Beviset søges i den rækkefølge, der er billigst for ejeren: fingeraftryk
 * eller ansigt, ellers app-lås-koden, ellers kontoens adgangskode. Findes ingen
 * af delene, er der intet at bevise med, og handlingen får lov — at spærre den
 * ville låse brugeren ude af sine egne data uden at gøre nogen sikrere.
 */

type PromptMode = 'checking' | 'pin' | 'password';

export function useSensitiveAction() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const session = useAuthStore((s) => s.session);

  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<PromptMode>('checking');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const pending = useRef<(() => void | Promise<void>) | null>(null);

  const finish = useCallback(async () => {
    markVerified();
    setVisible(false);
    setSecret('');
    setError(null);

    const action = pending.current;
    pending.current = null;
    await action?.();
  }, []);

  /** Vælger den stærkeste faktor, enheden faktisk har. */
  const beginChallenge = useCallback(async () => {
    setMode('checking');
    setError(null);

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = hasHardware ? await LocalAuthentication.isEnrolledAsync() : false;

    if (isEnrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('reauth.prompt'),
        cancelLabel: t('warranties.cancel'),
      });
      if (result.success) {
        await finish();
        return;
      }
      // Afbrudt eller mislykket: fald ned ad stigen frem for at give op.
    }

    if (await hasPin()) {
      setMode('pin');
      return;
    }

    setMode('password');
  }, [finish, t]);

  useEffect(() => {
    if (visible) beginChallenge();
  }, [visible, beginChallenge]);

  const run = useCallback(async (action: () => void | Promise<void>) => {
    // Er beviset stadig friskt, sker der ingenting synligt.
    if (!requiresReauthNow()) {
      await action();
      return;
    }
    pending.current = action;
    setVisible(true);
  }, []);

  const cancel = () => {
    pending.current = null;
    setVisible(false);
    setSecret('');
    setError(null);
  };

  const submit = async () => {
    setIsChecking(true);
    try {
      if (mode === 'pin') {
        if (await verifyPin(secret)) {
          await finish();
          return;
        }
        setError(t('reauth.wrongPin'));
        return;
      }

      const email = session?.user.email;
      if (!email) {
        setError(t('auth.errorGeneric'));
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: secret });
      if (signInError) {
        setError(t('auth.errorInvalidCredentials'));
        return;
      }
      await finish();
    } finally {
      setIsChecking(false);
    }
  };

  const prompt = (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <Card style={[styles.card, { backgroundColor }]}>
          <Text style={styles.title}>{t('reauth.title')}</Text>
          <Text style={[styles.body, { color: textMuted }]}>{t('reauth.body')}</Text>

          {mode === 'checking' && <Text style={[styles.body, { color: textMuted }]}>{t('reauth.checking')}</Text>}

          {mode !== 'checking' && (
            <TextInput
              style={[styles.input, { borderColor, backgroundColor: surface }]}
              placeholder={t(mode === 'pin' ? 'reauth.pinPlaceholder' : 'reauth.passwordPlaceholder')}
              placeholderTextColor={borderColor}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={mode === 'pin' ? 'number-pad' : 'default'}
              autoComplete={mode === 'pin' ? 'off' : 'current-password'}
              textContentType={mode === 'pin' ? 'none' : 'password'}
              accessibilityLabel={t(mode === 'pin' ? 'reauth.pinPlaceholder' : 'reauth.passwordPlaceholder')}
              value={secret}
              onChangeText={setSecret}
            />
          )}

          {error && <Text style={{ color: danger, fontSize: 13 }}>{error}</Text>}

          {mode !== 'checking' && (
            <Button label={t('reauth.confirm')} disabled={isChecking || secret.length === 0} onPress={submit} />
          )}

          <Pressable
            accessibilityRole="button"
            onPress={cancel}
            style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: textMuted }}>{t('warranties.cancel')}</Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );

  return { run, prompt };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card: { gap: 10 },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
});

import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import { signInErrorKey, signUpOutcome } from '@/core/auth/authErrors';
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/core/auth/passwordPolicy';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAuthStore } from '@/store/useAuthStore';


export default function AuthScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');

  const signUp = useAuthStore((s) => s.signUp);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const signIn = useAuthStore((s) => s.signIn);

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const requestPasswordReset = async () => {
    setError(null);
    if (!isValidEmail) {
      setError(t('auth.invalidEmailError'));
      return;
    }
    await sendPasswordReset(email.trim());
    // Samme kvittering, uanset om adressen findes. Ejeren får en mail; alle
    // andre får intet at vide (ADR-0014).
    Alert.alert(t('auth.resetSentTitle'), t('auth.resetSentBody'));
  };

  const submit = async () => {
    setError(null);

    if (!isValidEmail) {
      setError(t('auth.invalidEmailError'));
      return;
    }
    // Kun ved oprettelse. Et eksisterende kodeord er allerede accepteret, og at
    // måle det mod dagens regel ville låse brugeren ude af sin egen konto.
    if (mode === 'signUp') {
      const problem = newPasswordProblem(password);
      if (problem) {
        setError(t(problem, { min: MIN_PASSWORD_LENGTH }));
        return;
      }
    }
    setIsSubmitting(true);
    try {
      if (mode === 'signIn') {
        const { error: signInError } = await signIn(email.trim(), password);
        // Providerens tekst når aldrig skærmen — den ville røbe, hvilke
        // adresser der findes. Se core/auth/authErrors.ts.
        const key = signInErrorKey(signInError);
        if (key) setError(t(key));
      } else {
        const { error: signUpError, session: signUpSession } = await signUp(email.trim(), password);
        const outcome = signUpOutcome(signUpError, !!signUpSession);

        if (outcome.kind === 'error') {
          setError(t(outcome.key));
        } else if (outcome.kind === 'check-inbox') {
          // Samme svar, uanset om adressen var kendt i forvejen. Ejeren får en
          // mail og kan komme videre; alle andre får intet at vide.
          Alert.alert(t('auth.signUpSuccessTitle'), t('auth.signUpSuccessBody'));
          setMode('signIn');
        } else {
          // Session med det samme: bekræftelse er slået fra i projektet.
          router.push('/onboarding-pin');
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: tint }]}>{t('auth.welcomeTitle')}</Text>
        <Text style={[styles.subtitle, { color: textMuted }]}>{t('auth.welcomeSubtitle')}</Text>

        <Card style={sharedStyles.card}>
          <TextInput
            style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
            placeholder={t('auth.emailPlaceholder')}
            placeholderTextColor={borderColor}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            keyboardType="email-address"
            inputMode="email"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
            placeholder={t('auth.passwordPlaceholder')}
            placeholderTextColor={borderColor}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            // Ved oprettelse skal manageren tilbyde at GENERERE en kode, ikke
            // udfylde den gamle. Det er forskellen på de to værdier her.
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
            // Uden en regel antager iOS sine egne krav og laver en kode, appen
            // så afviser. Her står præcis dét, vi faktisk kræver.
            passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
            value={password}
            onChangeText={setPassword}
          />


          {/* Oprettelse spørger kun om det, en konto ikke kan undvære. Navn og
              køn er valgfrie og hører til bagefter — se APP-017. */}
          {mode === 'signUp' && (
            <Text style={{ color: textMuted, fontSize: 12, lineHeight: 17 }}>{t('auth.minimalFieldsNote')}</Text>
          )}

          {mode === 'signIn' && (
            <Text
              accessibilityRole="button"
              style={[styles.switchLink, { color: tint, marginTop: 0 }]}
              onPress={requestPasswordReset}
            >
              {t('auth.forgotPassword')}
            </Text>
          )}

          {error && <Text style={{ color: danger, fontSize: 13 }}>{error}</Text>}

          <Button
            label={mode === 'signIn' ? t('auth.signInButton') : t('auth.signUpButton')}
            disabled={isSubmitting}
            onPress={submit}
          />
        </Card>

        <Text
          style={[styles.switchLink, { color: tint }]}
          onPress={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
          }}>
          {mode === 'signIn' ? t('auth.switchToSignUp') : t('auth.switchToSignIn')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = {
  container: { flexGrow: 1, justifyContent: 'center' as const, padding: 20, gap: 16 },
  title: { fontSize: 26, fontWeight: '800' as const, textAlign: 'center' as const },
  subtitle: { fontSize: 14, textAlign: 'center' as const, marginBottom: 4 },
  switchLink: { textAlign: 'center' as const, fontSize: 13, fontWeight: '700' as const, marginTop: 4 },
};
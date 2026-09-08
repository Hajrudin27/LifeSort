import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { signInErrorKey } from '@/core/auth/authErrors';
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/core/auth/passwordPolicy';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';

/**
 * Sæt et nyt kodeord (APP-019).
 *
 * Nås kun via linket fra nulstillingsmailen: rod-layoutet har allerede byttet
 * linkets tokens til en session, inden skærmen her vises.
 */
export default function NewPasswordScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const tint = useThemeColor({}, 'tint');

  const setNewPassword = useAuthStore((s) => s.setNewPassword);
  const showToast = useToastStore((s) => s.show);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const save = async () => {
    setError(null);

    const problem = newPasswordProblem(password);
    if (problem) {
      setError(t(problem, { min: MIN_PASSWORD_LENGTH }));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await setNewPassword(password);
      if (updateError) {
        // Providerens tekst når heller ikke skærmen her.
        setError(t(signInErrorKey(updateError) ?? 'auth.errorGeneric'));
        return;
      }
      showToast(t('auth.resetDoneToast'));
      router.replace('/');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontWeight: '800', color: tint }}>{t('auth.newPasswordTitle')}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: textMuted }}>
          {t('auth.newPasswordBody', { min: MIN_PASSWORD_LENGTH })}
        </Text>

        <Card style={sharedStyles.card}>
          <TextInput
            style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
            placeholder={t('auth.passwordPlaceholder')}
            placeholderTextColor={borderColor}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            // Samme signal som ved oprettelse: manageren skal tilbyde at
            // generere og gemme en ny kode, ikke udfylde den gamle.
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
            value={password}
            onChangeText={setPassword}
          />

          {error && <Text style={{ color: danger, fontSize: 13 }}>{error}</Text>}

          <Button label={t('auth.newPasswordButton')} disabled={isSubmitting} onPress={save} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

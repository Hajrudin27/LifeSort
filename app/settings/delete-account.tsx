import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { supabase } from '@/lib/supabase';
import { useToastStore } from '@/store/useToastStore';
import { deleteAccount } from '@/utils/auth/deleteAccount';

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const showToast = useToastStore((s) => s.show);

  const [email, setEmail] = useState<string | null>(null);
  const [typedEmail, setTypedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  // Sletningen kan ikke fortrydes, så den kræver to ting af brugeren: at skrive sin egen
  // adresse (så et fejlklik ikke er nok) og sin adgangskode (så en efterladt, ulåst telefon
  // ikke er nok).
  const emailMatches =
    email !== null && typedEmail.trim().toLowerCase() === email.trim().toLowerCase();
  const canDelete = emailMatches && password.length > 0 && !isDeleting;

  const handleDelete = async () => {
    if (!canDelete || !email) return;
    setError(null);
    setIsDeleting(true);

    // Adgangskoden tjekkes ved at logge ind igen. Det er den samme kontrol som ved login,
    // og den bekræfter at det er kontoens ejer der sidder med telefonen lige nu.
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(t('deleteAccount.wrongPassword'));
      setIsDeleting(false);
      return;
    }

    const result = await deleteAccount();

    if (result.error === 'admin_account') {
      setError(t('deleteAccount.adminAccountError'));
      setIsDeleting(false);
      return;
    }
    if (result.error) {
      setError(t('deleteAccount.genericError'));
      setIsDeleting(false);
      return;
    }

    showToast(t('deleteAccount.done'));
    router.replace('/');
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('deleteAccount.title') }} />

      <Card style={sharedStyles.card}>
        <Text style={{ fontWeight: '600' }}>{t('deleteAccount.heading')}</Text>
        <Text style={[{ fontSize: 13 }, { color: textMuted }]}>{t('deleteAccount.explanation')}</Text>
        <Text style={[{ fontSize: 13 }, { color: textMuted }]}>{t('deleteAccount.permanentWarning')}</Text>
      </Card>

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>
          {t('deleteAccount.confirmEmailLabel', { email: email ?? '' })}
        </Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={email ?? ''}
          placeholderTextColor={borderColor}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={typedEmail}
          onChangeText={setTypedEmail}
        />

        <Text style={sharedStyles.fieldLabel}>{t('deleteAccount.passwordLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('deleteAccount.passwordPlaceholder')}
          placeholderTextColor={borderColor}
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={{ color: danger, fontSize: 13 }}>{error}</Text>}
      </Card>

      <Button
        label={isDeleting ? t('deleteAccount.deleting') : t('deleteAccount.deleteButton')}
        variant="danger"
        disabled={!canDelete}
        onPress={handleDelete}
      />
    </ScrollView>
  );
}

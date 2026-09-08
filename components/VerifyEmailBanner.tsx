import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import {
  readLastSentAt,
  resendCooldownRemainingMs,
} from '@/core/auth/emailVerification';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';

/**
 * Påmindelsen om at bekræfte sin e-mail (APP-018).
 *
 * Vises kun, hvis der er en session, og adressen ikke er bekræftet. Er
 * bekræftelse slået fra i Supabase-projektet, er alle bekræftede, og banneret
 * findes aldrig.
 */
export default function VerifyEmailBanner() {
  const { t } = useTranslation();
  const warning = useThemeColor({}, 'warning');
  const textMuted = useThemeColor({}, 'textMuted');

  const session = useAuthStore((s) => s.session);
  const verified = useAuthStore((s) => s.isEmailVerified);
  const resendVerificationEmail = useAuthStore((s) => s.resendVerificationEmail);
  const showToast = useToastStore((s) => s.show);

  const [remainingMs, setRemainingMs] = useState(0);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readLastSentAt().then((lastSentAt) => {
      if (!cancelled) setRemainingMs(resendCooldownRemainingMs(lastSentAt, Date.now()));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (remainingMs <= 0) return;
    const timer = setInterval(() => setRemainingMs((current) => Math.max(0, current - 1000)), 1000);
    return () => clearInterval(timer);
  }, [remainingMs > 0]);

  const email = session?.user.email;
  if (!session || verified || !email) return null;

  const send = async () => {
    setIsSending(true);
    try {
      await resendVerificationEmail(email);
      const lastSentAt = await readLastSentAt();
      setRemainingMs(resendCooldownRemainingMs(lastSentAt, Date.now()));
      // Samme kvittering, uanset hvad serveren svarede. Et andet svar for en
      // ukendt adresse ville være kontooptælling ad bagvejen.
      showToast(t('auth.verifyResendSent'));
    } finally {
      setIsSending(false);
    }
  };

  const waiting = remainingMs > 0;

  return (
    <Card style={[styles.card, { borderColor: warning }]}>
      <Text style={styles.title}>{t('auth.verifyBannerTitle')}</Text>
      <Text style={[styles.body, { color: textMuted }]}>{t('auth.verifyBannerBody', { email })}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('auth.verifyResend')}
        accessibilityState={{ disabled: waiting || isSending }}
        disabled={waiting || isSending}
        onPress={send}
        style={[styles.button, { borderColor: warning, opacity: waiting || isSending ? 0.5 : 1 }]}
      >
        <Text style={styles.buttonText}>
          {waiting ? t('auth.verifyResendWait', { seconds: Math.ceil(remainingMs / 1000) }) : t('auth.verifyResend')}
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, gap: 6 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  button: {
    minHeight: 44,
    marginTop: 6,
    borderWidth: 1.5,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
});

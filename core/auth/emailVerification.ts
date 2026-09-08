import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * E-mail-bekræftelse (APP-018).
 *
 * Bekræftelsen beviser, at brugeren faktisk kan læse den adresse, kontoen er
 * oprettet på. Uden det bevis kan man oprette en konto på en fremmed adresse —
 * og fra den konto sende invitationer, der ser ud til at komme derfra.
 */

/** Kun én mail pr. minut. Serveren har sin egen grænse; det her er høfligheden. */
export const RESEND_COOLDOWN_MS = 60_000;

const LAST_SENT_KEY = 'lifesort-verification-last-sent';

type SessionLike = {
  user?: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null;
} | null;

/**
 * Er adressen bekræftet?
 *
 * Ingen session betyder ikke bekræftet — ikke "ved ikke". Tvivl falder ud til
 * det sikre, som alle andre steder i appen.
 */
export function isEmailVerified(session: SessionLike): boolean {
  const user = session?.user;
  if (!user) return false;
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

/** Millisekunder til næste gang der må sendes. 0 betyder "nu". */
export function resendCooldownRemainingMs(lastSentAt: number | null, now: number): number {
  if (lastSentAt === null) return 0;

  // Et ur, der er stillet tilbage, må ikke give en spærretid på flere timer —
  // og et ur, der er stillet frem, må ikke låse op for ubegrænsede forsøg.
  if (lastSentAt > now) return RESEND_COOLDOWN_MS;

  return Math.max(0, RESEND_COOLDOWN_MS - (now - lastSentAt));
}

export async function readLastSentAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_SENT_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function recordSentNow(now: number = Date.now()): Promise<void> {
  await AsyncStorage.setItem(LAST_SENT_KEY, String(now));
}

export async function clearResendThrottle(): Promise<void> {
  await AsyncStorage.removeItem(LAST_SENT_KEY);
}

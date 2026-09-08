import {
  signInErrorKey,
  signUpErrorKey,
  signUpOutcome,
} from '@/core/auth/authErrors';
import {
  isEmailVerified,
  RESEND_COOLDOWN_MS,
  resendCooldownRemainingMs,
} from '@/core/auth/emailVerification';

/**
 * APP-018 — bekræftelse, spærretid og ingen kontooptælling.
 */

describe('kontooptælling', () => {
  it('svarer det samme, uanset om adressen findes i forvejen', () => {
    // Det her er hele pointen: den, der prøver med en fremmed adresse, må ikke
    // kunne se forskel på "oprettet" og "findes allerede".
    const existing = signUpOutcome('User already registered', false);
    const fresh = signUpOutcome(null, false);
    expect(existing).toEqual(fresh);
    expect(existing.kind).toBe('check-inbox');
  });

  it('genkender providerens forskellige måder at sige det på', () => {
    for (const message of ['User already registered', 'A user with this email already exists', 'user already exists']) {
      expect(signUpOutcome(message, false).kind).toBe('check-inbox');
    }
  });

  it('har ingen fejlnøgle, der kan afsløre en eksisterende konto', () => {
    // Findes nøglen ikke, kan den ikke vises ved et uheld.
    expect(signUpErrorKey('User already registered')).toBe('auth.errorGeneric');
  });

  it('giver samme svar for forkert kodeord og ukendt bruger', () => {
    // Supabase bruger allerede én besked; testen fastholder, at vi ikke
    // begynder at oversætte den til to.
    expect(signInErrorKey('Invalid login credentials')).toBe('auth.errorInvalidCredentials');
    expect(signInErrorKey('Invalid email or password')).toBe('auth.errorInvalidCredentials');
  });
});

describe('fejlbeskeder', () => {
  it('slipper aldrig providerens egen tekst igennem', () => {
    // Alt ukendt lander på den generiske nøgle frem for at blive vist råt.
    for (const message of ['Database error saving new user', 'unexpected_failure', 'こんにちは']) {
      expect(signInErrorKey(message)).toBe('auth.errorGeneric');
      expect(signUpErrorKey(message)).toBe('auth.errorGeneric');
    }
  });

  it('skelner de tilfælde, brugeren kan gøre noget ved', () => {
    expect(signInErrorKey('Email not confirmed')).toBe('auth.errorEmailNotConfirmed');
    expect(signInErrorKey('For security purposes, you can only request this after 41 seconds')).toBe('auth.errorRateLimited');
    expect(signInErrorKey('Network request failed')).toBe('auth.errorNetwork');
  });

  it('siger ingenting, når der ingen fejl er', () => {
    expect(signInErrorKey(null)).toBeNull();
    expect(signUpErrorKey(null)).toBeNull();
  });

  it('logger brugeren ind, når serveren ikke kræver bekræftelse', () => {
    expect(signUpOutcome(null, true).kind).toBe('signed-in');
  });
});

describe('bekræftet tilstand', () => {
  it('kræver et bevis, ikke bare en session', () => {
    expect(isEmailVerified({ user: { email_confirmed_at: '2026-09-07T10:00:00Z' } })).toBe(true);
    expect(isEmailVerified({ user: { email_confirmed_at: null } })).toBe(false);
  });

  it('accepterer det ældre felt, Supabase også sætter', () => {
    expect(isEmailVerified({ user: { confirmed_at: '2026-09-07T10:00:00Z' } })).toBe(true);
  });

  it('behandler ingen session som ikke bekræftet', () => {
    // Tvivl falder ud til det sikre, som alle andre steder i appen.
    expect(isEmailVerified(null)).toBe(false);
    expect(isEmailVerified({ user: null })).toBe(false);
    expect(isEmailVerified({})).toBe(false);
  });
});

describe('spærretid på gensendelse', () => {
  const now = 1_800_000_000_000;

  it('tillader den første med det samme', () => {
    expect(resendCooldownRemainingMs(null, now)).toBe(0);
  });

  it('holder igen i et minut', () => {
    expect(resendCooldownRemainingMs(now, now)).toBe(RESEND_COOLDOWN_MS);
    expect(resendCooldownRemainingMs(now - 30_000, now)).toBe(30_000);
    expect(resendCooldownRemainingMs(now - RESEND_COOLDOWN_MS, now)).toBe(0);
    expect(resendCooldownRemainingMs(now - 999_999, now)).toBe(0);
  });

  it('lader sig ikke omgå ved at stille uret', () => {
    // Et tidspunkt i fremtiden ville ellers give en negativ rest — altså fri bane.
    expect(resendCooldownRemainingMs(now + 60_000, now)).toBe(RESEND_COOLDOWN_MS);
  });
});

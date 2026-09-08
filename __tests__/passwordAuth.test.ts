/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '@/core/auth/passwordPolicy';
import { parseRecoveryLink } from '@/core/auth/recoveryLink';

/**
 * APP-019 — kodeord skal kunne genereres af en manager, og nulstillingslinket
 * skal kunne komme fra hvem som helst uden at gøre skade.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

describe('kodeordskrav', () => {
  it('kræver kun længde', () => {
    // En manager-genereret kode uden tal skal gå igennem. Krav om tal og tegn
    // gør kun koder forudsigelige.
    expect(newPasswordProblem('correcthorsebatterystaple')).toBeNull();
    expect(newPasswordProblem('ábcdefghij')).toBeNull();
    expect(newPasswordProblem('        ')).toBeNull();
  });

  it('afviser kun det for korte', () => {
    expect(newPasswordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(newPasswordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('auth.passwordTooShort');
    expect(newPasswordProblem('')).toBe('auth.passwordTooShort');
  });

  it('accepterer en lang kode fra en manager uden vrøvl', () => {
    expect(newPasswordProblem('Tz7$k2!xPq9wLm4@vNb8#rHs5')).toBeNull();
    expect(newPasswordProblem('kaffe hest batteri hæfteklamme')).toBeNull();
  });
});

describe('reglen gælder kun nye kodeord', () => {
  const source = read('app/auth.tsx');

  it('måler ikke et eksisterende kodeord ved login', () => {
    // Ellers ville en bruger med en ældre, kortere kode blive låst ude af sin
    // egen konto af en regel, vi har ændret bagefter.
    expect(source).toContain("if (mode === 'signUp') {");
    expect(source).not.toMatch(/password\.length < \d/);
  });
});

describe('felterne kan udfyldes af en kodeordsmanager', () => {
  const source = read('app/auth.tsx');

  it('mærker brugernavnsfeltet', () => {
    expect(source).toContain('textContentType="username"');
    expect(source).toContain('autoComplete="email"');
  });

  it('beder om en NY kode ved oprettelse og den gamle ved login', () => {
    // Forskellen er dét, der afgør, om manageren tilbyder at generere.
    expect(source).toContain("mode === 'signUp' ? 'new-password' : 'current-password'");
    expect(source).toContain("mode === 'signUp' ? 'newPassword' : 'password'");
  });

  it('fortæller iOS præcis den regel, vi faktisk har', () => {
    // Uden en regel gætter iOS sine egne krav og laver en kode, appen afviser.
    expect(source).toContain('passwordRules=');
    expect(read('app/new-password.tsx')).toContain('passwordRules=');
  });

  it('slår rettelser og store bogstaver fra i begge felter', () => {
    expect(source.match(/autoCorrect=\{false\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('nulstillingslinket', () => {
  const tokens = 'access_token=abc123&refresh_token=def456';

  it('læser tokens fra fragmentet', () => {
    expect(parseRecoveryLink(`lifesort://new-password#${tokens}&type=recovery`)).toEqual({
      accessToken: 'abc123',
      refreshToken: 'def456',
    });
  });

  it('læser dem også fra query-strengen', () => {
    expect(parseRecoveryLink(`lifesort://new-password?${tokens}&type=recovery`)).toEqual({
      accessToken: 'abc123',
      refreshToken: 'def456',
    });
  });

  it('afviser et link, der ikke siger at det er en nulstilling', () => {
    // Uden det tjek ville ethvert link med tokens kunne logge nogen ind på en
    // fremmed konto — en åben dør i stedet for en nulstilling.
    expect(parseRecoveryLink(`lifesort://new-password#${tokens}`)).toBeNull();
    expect(parseRecoveryLink(`lifesort://new-password#${tokens}&type=magiclink`)).toBeNull();
    expect(parseRecoveryLink(`lifesort://new-password#${tokens}&type=signup`)).toBeNull();
  });

  it('afviser et halvt link', () => {
    expect(parseRecoveryLink('lifesort://new-password#access_token=abc123&type=recovery')).toBeNull();
    expect(parseRecoveryLink('lifesort://new-password#refresh_token=def456&type=recovery')).toBeNull();
    expect(parseRecoveryLink('lifesort://new-password#access_token=&refresh_token=&type=recovery')).toBeNull();
  });

  it('kaster aldrig, uanset hvad der åbner appen', () => {
    for (const url of ['', 'ikke en url', 'lifesort://', 'lifesort://x#%%%&type=recovery', '#&&&=', 'lifesort://a?b']) {
      expect(() => parseRecoveryLink(url)).not.toThrow();
    }
    expect(parseRecoveryLink('lifesort://x#%E0%A4%A&type=recovery')).toBeNull();
  });

  it('afkoder procent-kodede værdier', () => {
    const url = 'lifesort://new-password#access_token=a%2Bb&refresh_token=c%2Fd&type=recovery';
    expect(parseRecoveryLink(url)).toEqual({ accessToken: 'a+b', refreshToken: 'c/d' });
  });
});

describe('nulstilling afslører ikke, hvem der har en konto', () => {
  it('kvitterer ens, uanset om adressen findes', () => {
    // Kaldet kaster udfaldet væk med vilje; skærmen har kun én besked.
    const store = read('store/useAuthStore.ts');
    expect(store).toContain('await supabase.auth.resetPasswordForEmail(');
    expect(store).not.toMatch(/resetPasswordForEmail[\s\S]{0,200}return \{ error/);

    const screen = read('app/auth.tsx');
    expect(screen).toContain("t('auth.resetSentTitle')");
    expect(screen).not.toMatch(/resetError|resetPasswordError/);
  });
});

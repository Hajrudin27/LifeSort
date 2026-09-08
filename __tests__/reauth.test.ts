/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import {
  clearVerification,
  markVerified,
  needsReauth,
  REAUTH_WINDOW_MS,
  requiresReauthNow,
  SENSITIVE_ACTIONS,
} from '@/core/auth/reauth';

/**
 * APP-024 — beviset for "det er stadig dig".
 *
 * Truslen er en ulåst telefon på et bord, ikke en fjern angriber. Testene
 * handler derfor om, hvornår appen holder op med at stole på, at den, der
 * holder telefonen, er ejeren.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
const NOW = 1_800_000_000_000;

describe('vinduet', () => {
  it('spørger, når der aldrig er bekræftet', () => {
    expect(needsReauth(null, NOW)).toBe(true);
  });

  it('spørger ikke igen med det samme', () => {
    // Eksporterer man to gange i træk, skal man ikke bevise sig to gange.
    expect(needsReauth(NOW, NOW)).toBe(false);
    expect(needsReauth(NOW - 1000, NOW)).toBe(false);
  });

  it('spørger igen, når vinduet er udløbet', () => {
    expect(needsReauth(NOW - REAUTH_WINDOW_MS, NOW)).toBe(true);
    expect(needsReauth(NOW - REAUTH_WINDOW_MS - 1, NOW)).toBe(true);
  });

  it('lader sig ikke omgå ved at stille uret frem', () => {
    // Et bevis dateret i fremtiden ville ellers holde i evigheder.
    expect(needsReauth(NOW + 60_000, NOW)).toBe(true);
  });

  it('holder ikke længere end få minutter', () => {
    // Et langt vindue gør beviset ligegyldigt.
    expect(REAUTH_WINDOW_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe('beviset kan glemmes', () => {
  beforeEach(() => clearVerification());

  it('gælder lige efter det er givet', () => {
    markVerified(Date.now());
    expect(requiresReauthNow()).toBe(false);
  });

  it('glemmes, når det ryddes', () => {
    // Kaldes både ved log ud og hver gang appen har været i baggrunden.
    markVerified(Date.now());
    clearVerification();
    expect(requiresReauthNow()).toBe(true);
  });
});

describe('hvilke handlinger der er dækket', () => {
  it('dækker eksport og deling, og hver med en grund', () => {
    expect(Object.keys(SENSITIVE_ACTIONS).sort()).toEqual(['export-data', 'share-file']);
    for (const reason of Object.values(SENSITIVE_ACTIONS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('eksporten er faktisk spærret', () => {
    const screen = read('app/settings/backup.tsx');
    expect(screen).toContain('useSensitiveAction');
    expect(screen).toContain('runSensitive(async () => {');
    expect(screen).toContain('{reauthPrompt}');
  });

  it('deling af en vedhæftning er faktisk spærret', () => {
    const component = read('components/TripAttachmentGrid.tsx');
    expect(component).toContain('runSensitive(async () => {');
    expect(component).toContain('Sharing.shareAsync');
    expect(component).toContain('{reauthPrompt}');
  });

  it('sletning af konto bruger fortsat kontoens adgangskode', () => {
    // Sletning sker på serveren, så beviset skal også være serverens
    // (ADR-0007): en lokal kode må ikke kunne slette en konto.
    expect(read('app/settings/delete-account.tsx')).toContain('signInWithPassword');
  });

  it('at se et billede inde i appen er ikke en følsom handling', () => {
    // Spærrede man dét, ville brugeren skulle bevise sig for at kigge på sit
    // eget indhold — friktion uden gevinst.
    const component = read('components/TripAttachmentGrid.tsx');
    const viewBranch = component.slice(component.indexOf('attachment.kind === "image"'));
    expect(viewBranch.slice(0, 260)).not.toContain('runSensitive');
  });
});

describe('beviset ryddes med brugeren', () => {
  it('ved log ud', () => {
    expect(read('core/auth/clearLocalUserData.ts')).toContain('clearVerification()');
  });

  it('og når appen har været i baggrunden', () => {
    // En telefon, der har været ude af syne, kan have skiftet hænder.
    expect(read('app/_layout.tsx')).toContain('clearVerification()');
  });
});

describe('stigen af faktorer', () => {
  const component = read('components/useSensitiveAction.tsx');

  it('prøver biometri først', () => {
    expect(component).toContain('LocalAuthentication.authenticateAsync');
  });

  it('falder tilbage til app-låsens kode, hvis den findes', () => {
    expect(component).toContain('await hasPin()');
    expect(component).toContain('verifyPin(secret)');
  });

  it('og ellers til kontoens adgangskode', () => {
    expect(component).toContain('signInWithPassword');
  });

  it('spærrer ikke en bruger uden nogen faktor ude af sine egne data', () => {
    // Har enheden hverken biometri eller kode, og kontoen ingen adgangskode i
    // hånden, ville en spærring låse ejeren ude uden at gøre nogen sikrere.
    expect(component).toContain("setMode('password')");
  });
});

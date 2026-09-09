/// <reference types="node" />

import fs from 'fs';
import path from 'path';

/**
 * APP-017 — oprettelse må kun spørge om det, kontoen ikke kan undvære.
 *
 * Felter har en tendens til at snige sig tilbage ind i et oprettelsesflow, ét
 * ad gangen, hver med en god grund. Testen holder listen kort og tvinger en
 * bevidst beslutning, hvis den skal være længere.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

/** Finder en migration på dens navn uden tidsstempel — Supabase omdøber dem. */
function readMigration(suffix: string): string {
  const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
  const file = fs.readdirSync(dir).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`Ingen migration der ender på "${suffix}"`);
  return fs.readFileSync(path.join(dir, file), 'utf8');
}


describe('oprettelsesskærmen', () => {
  const source = read('app/auth.tsx');

  it('spørger kun om e-mail og adgangskode', () => {
    const placeholders = [...source.matchAll(/placeholder=\{t\('([^']+)'\)\}/g)].map((match) => match[1]);
    expect(placeholders.sort()).toEqual(['auth.emailPlaceholder', 'auth.passwordPlaceholder']);
  });

  it('spørger hverken om alder eller køn', () => {
    // De to felter, APP-002 fandt uden formål (D1) og med et forkert formål (D2).
    expect(source).not.toMatch(/\bage\b/i);
    expect(source).not.toMatch(/\bgender\b/i);
  });

  it('sender ikke profildata med til Supabase ved oprettelse', () => {
    // options.data ville lande i auth-brugerens metadata, hvor det er svært at
    // få øje på og lige så svært at slette.
    const authStore = read('store/useAuthStore.ts');
    expect(authStore).toContain('supabase.auth.signUp({ email, password })');
    expect(authStore).not.toMatch(/options:\s*\{\s*data:/);
  });
});

describe('alder samles ikke længere ind', () => {
  it('ikke i nogen skærm', () => {
    for (const file of ['app/auth.tsx', 'app/onboarding-profile.tsx', 'app/settings/profile.tsx']) {
      expect(read(file)).not.toMatch(/profile\.ageLabel|setAge\(/);
    }
  });

  it('og ikke i profilens type', () => {
    // Et felt, ingen funktion læser, er data uden formål.
    expect(read('types/profile.ts')).not.toMatch(/^\s*age\??:/m);
  });

  it('og onboarding hviler ikke længere på at alderen var udfyldt', () => {
    // Det gamle kriterium var `!!data.name && data.age !== null` — alderen var
    // utilsigtet blevet beviset for at have gennemført onboarding.
    const profileStore = read('store/useProfileStore.ts');
    expect(profileStore).toContain('data.onboarded_at !== null');
    expect(profileStore).not.toMatch(/data\.age/);
  });
});

describe('navn og køn er valgfrie', () => {
  it('onboarding kan gennemføres uden at udfylde noget', () => {
    const onboarding = read('app/onboarding-profile.tsx');
    expect(onboarding).toContain('const canSave = true;');
  });

  it('afsluttes eksplicit på sidste trin, ikke af et udfyldt felt', () => {
    // APP-020 flyttede afslutningen til modul-valget, som er det sidste trin.
    expect(read('app/onboarding-modules.tsx')).toContain('markOnboarded()');
  });

  it('profilen kan gemmes uden et navn', () => {
    expect(read('app/settings/profile.tsx')).toContain('const canSave = true;');
  });
});

describe('migrationen efterlader ingen bag sig', () => {
  const migration = readMigration('_profiles_onboarded_at.sql');

  it('udfylder onboarded_at for dem, der allerede var igennem', () => {
    // Ellers ville hele den eksisterende brugerbase blive sendt gennem
    // onboarding igen ved næste opdatering.
    expect(migration).toMatch(/update public\.profiles/);
    expect(migration).toMatch(/name is not null/);
    expect(migration).toMatch(/age is not null/);
  });

  it('sletter ikke alderskolonnen som en sidegevinst', () => {
    // At droppe en kolonne sletter brugerdata og skal besluttes for sig.
    expect(migration).not.toMatch(/drop column/i);
  });
});

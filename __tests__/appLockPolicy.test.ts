/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import {
  LOCK_RECOMMENDED_SENSITIVITIES,
  moduleWantsAppLock,
  shouldRecommendAppLock,
} from '@/core/auth/appLockPolicy';
import { MODULE_IDS, type ModuleId } from '@/core/modules/moduleRegistry';

/**
 * APP-026 — app-låsen beskytter telefonen, ikke kontoen.
 *
 * To ting skal holde: at vi foreslår den, hvor den gør en forskel, og at den
 * aldrig kommer til at stå i vejen for noget, serveren selv skal kontrollere.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

describe('hvornår vi foreslår låsen', () => {
  it('når et helbredsmodul er slået til og låsen fra', () => {
    expect(shouldRecommendAppLock({ lockEnabled: false, enabledModuleIds: ['cycle'], dismissed: false })).toBe(true);
  });

  it('ikke når låsen allerede er slået til', () => {
    expect(shouldRecommendAppLock({ lockEnabled: true, enabledModuleIds: ['cycle'], dismissed: false })).toBe(false);
  });

  it('ikke når brugeren har sagt nej', () => {
    // Et forslag, der bliver ved med at komme igen, lærer folk at klikke det
    // væk uden at læse det.
    expect(shouldRecommendAppLock({ lockEnabled: false, enabledModuleIds: ['cycle'], dismissed: true })).toBe(false);
  });

  it('ikke når der ikke er noget helbred at beskytte', () => {
    expect(
      shouldRecommendAppLock({
        lockEnabled: false,
        enabledModuleIds: ['economy', 'food', 'travel'],
        dismissed: false,
      }),
    ).toBe(false);
  });
});

describe('hvilke moduler udløser forslaget', () => {
  it('kun helbred', () => {
    expect(moduleWantsAppLock('cycle')).toBe(true);
    for (const moduleId of ['economy', 'food', 'travel', 'warranties', 'career'] as ModuleId[]) {
      expect(moduleWantsAppLock(moduleId)).toBe(false);
    }
  });

  it('holder listen kort, så forslaget bliver ved med at betyde noget', () => {
    // Udløste enhver følsomhed det, ville næsten hvert modul gøre det, og så
    // er det ikke længere en anbefaling men en baggrundslyd.
    expect(LOCK_RECOMMENDED_SENSITIVITIES).toEqual(['health']);
    const triggering = MODULE_IDS.filter(moduleWantsAppLock);
    expect(triggering.length).toBeLessThanOrEqual(2);
  });
});

describe('der er en vej ud af en glemt kode', () => {
  const lockScreen = read('components/LockScreen.tsx');

  it('låseskærmen tilbyder at logge ud', () => {
    // Uden den er en glemt kode det samme som en ubrugelig app: koden kan ikke
    // gendannes, for den ligger kun på telefonen.
    expect(lockScreen).toContain('appLock.forgotPin');
    expect(lockScreen).toContain('signOut()');
  });

  it('siger hvad det koster, før man gør det', () => {
    // Log ud rydder telefonen, og filer der aldrig nåede skyen findes ikke
    // andre steder (fund D15).
    expect(lockScreen).toContain('appLock.forgotPinMessage');
    const da = JSON.parse(read('localization/locales/da/appLock.json'));
    expect(da.forgotPinMessage).toMatch(/går tabt/);
    expect(da.forgotPinMessage).toMatch(/kan ikke gendannes/);
  });
});

describe('låsen erstatter aldrig serverens kontrol', () => {
  it('siger grænsen, hvor brugeren møder låsen', () => {
    expect(read('components/LockScreen.tsx')).toContain('appLock.serverNote');
    const da = JSON.parse(read('localization/locales/da/appLock.json'));
    expect(da.serverNote).toMatch(/kun denne telefon/);
  });

  it('læses kun af skærme, der handler om låsen selv', () => {
    // Listen holdes kort med vilje. Dukker app-låsen op et sted, der skriver
    // til serveren, er den holdt op med at være en lokal bekvemmelighed og
    // blevet til en autorisation — se ADR-0007.
    const allowed = [
      'app/_layout.tsx',
      'app/(tabs)/settings.tsx',
      'app/modal.tsx',
      'components/AppLockSuggestion.tsx',
      'components/LockScreen.tsx',
      // APP-027 only classifies the persisted lock surface. It must not treat
      // the lock as server authorization.
      'core/storage/dataProfileRegistry.ts',
      'features/localStores.ts',
    ];

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(relative);
        else if (/\.tsx?$/.test(entry.name) && read(relative).includes('useAppLockStore')) found.push(relative);
      }
    };
    for (const dir of ['app', 'components', 'core', 'features']) walk(dir);

    expect(found.sort()).toEqual(allowed.sort());
  });

  it('sletning af konto beder stadig om kontoens adgangskode', () => {
    // Den stærkeste udgave af reglen: den mest uigenkaldelige handling i appen
    // kan ikke låses op med en firecifret kode.
    const screen = read('app/settings/delete-account.tsx');
    expect(screen).toContain('signInWithPassword');
    expect(screen).not.toContain('verifyPin');
  });
});

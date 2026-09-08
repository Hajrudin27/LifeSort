/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { CAN_LIST_SESSIONS, scopeAffectsThisDevice, type SessionScope } from '@/core/auth/sessions';

/**
 * APP-025 — hvilke enheder der bliver logget ud.
 *
 * Den vigtigste test her handler om noget, der allerede var galt: Supabase'
 * standard-scope er `global`, så et almindeligt "log ud" på telefonen lukkede
 * brugerens session på ALLE hendes enheder, uden at nogen havde bedt om det.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

describe('hvilke enheder et scope rammer', () => {
  it('rører den her enhed ved local og global', () => {
    expect(scopeAffectsThisDevice('local')).toBe(true);
    expect(scopeAffectsThisDevice('global')).toBe(true);
  });

  it('lader den her enhed være ved others', () => {
    // Ellers ville "log ud af de andre" logge dig ud af den, du står med.
    expect(scopeAffectsThisDevice('others')).toBe(false);
  });

  it('dækker alle tre scopes', () => {
    const scopes: SessionScope[] = ['local', 'others', 'global'];
    for (const scope of scopes) expect(typeof scopeAffectsThisDevice(scope)).toBe('boolean');
  });
});

describe('almindeligt log ud rammer kun denne enhed', () => {
  const store = read('store/useAuthStore.ts');

  it('siger scope udtrykkeligt', () => {
    // Uden det bruger Supabase `global`, og så lukker et log ud på telefonen
    // også brugerens session på computeren.
    expect(store).toContain("signOutWithScope('local')");
    expect(store).not.toMatch(/supabase\.auth\.signOut\(\)/);
  });

  it('rydder telefonen, når enheden er berørt', () => {
    expect(store).toContain('scopeAffectsThisDevice(scope)');
    expect(store).toContain('clearLocalUserData(LOCAL_STORE_RESETS)');
  });

  it('rydder IKKE telefonen, når kun de andre lukkes', () => {
    // 'others' går uden om helper'en netop for ikke at logge brugeren ud her.
    // lastIndexOf, fordi navnet også står i interface-erklæringen ovenfor.
    const othersBlock = store.slice(
      store.lastIndexOf('signOutOtherDevices:'),
      store.lastIndexOf('signOutEverywhere:'),
    );
    expect(othersBlock).toContain("scope: 'others'");
    expect(othersBlock).not.toContain('clearLocalUserData');
  });

  it('lukker alt, inklusive denne enhed, når man beder om det', () => {
    expect(store).toContain("signOutWithScope('global')");
  });
});

describe('ærlighed om det, appen ikke kan', () => {
  it('erklærer at sessioner ikke kan listes', () => {
    // Supabase-klienten har intet API til det, og admin-API'et kræver
    // servicenøglen, som aldrig må ligge i en app.
    expect(CAN_LIST_SESSIONS).toBe(false);
  });

  it('siger det til brugeren frem for at vise en tom liste', () => {
    // En tom liste ville ligne en fejl — eller værre, ligne "ingen andre
    // enheder er logget ind", hvilket vi ikke ved.
    const settings = read('app/(tabs)/settings.tsx');
    expect(settings).toContain('settings.sessionListUnavailable');
  });

  it('viser i det mindste den session, appen faktisk kender', () => {
    const settings = read('app/(tabs)/settings.tsx');
    expect(settings).toContain('last_sign_in_at');
    expect(settings).toContain('settings.sessionThisDevice');
  });
});

describe('begge handlinger spørger først', () => {
  const settings = read('app/(tabs)/settings.tsx');

  it('bekræfter, før andre enheder lukkes', () => {
    expect(settings).toContain('settings.signOutOthersConfirmTitle');
  });

  it('bekræfter, før alt lukkes', () => {
    expect(settings).toContain('settings.signOutEverywhereConfirmTitle');
  });

  it('lover ikke at data slettes', () => {
    // At logge ud overalt er ikke det samme som at slette noget, og teksten
    // skal ikke få det til at ligne hinanden.
    const da = JSON.parse(read('localization/locales/da/settings.json'));
    expect(da.signOutEverywhereConfirmMessage).toMatch(/ikke slettet/);
  });
});

import {
  isKillable,
  type ModuleFlagOverrides,
  parseModuleFlags,
  resolveModuleAvailability,
} from '@/core/feature-flags/moduleFlags';
import {
  evaluateModuleAccess,
  MODULE_AVAILABILITY,
  MODULE_AVAILABILITY_STATES,
  MODULE_IDS,
  PLATFORM_MODULE_IDS,
} from '@/core/modules/moduleAvailability';

const row = (module_id: string, availability: string) => ({ module_id, availability });

describe('parseModuleFlags — serverens svar er input udefra', () => {
  it('tager imod en gyldig række', () => {
    expect(parseModuleFlags([row('economy', 'maintenance')])).toEqual({ economy: 'maintenance' });
  });

  it('lader platformen være i fred, uanset hvad serveren siger', () => {
    // En række her ville låse brugeren ude af sin egen app — og af sletningen
    // af sin konto. Databasen afviser den også, men klienten må ikke stole på det.
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(parseModuleFlags([row(moduleId, 'retired')])).toEqual({});
      expect(isKillable(moduleId)).toBe(false);
    }
  });

  it('ignorerer ukendte tilstande frem for at gætte', () => {
    expect(parseModuleFlags([row('economy', 'banana')])).toEqual({});
    expect(parseModuleFlags([row('economy', 'AVAILABLE')])).toEqual({});
    expect(parseModuleFlags([row('economy', '')])).toEqual({});
  });

  it('ignorerer ukendte moduler — serveren kan være nyere end appen', () => {
    expect(parseModuleFlags([row('quantum-banking', 'hidden')])).toEqual({});
  });

  it('taber ikke de gode rækker på grund af en dårlig', () => {
    const parsed = parseModuleFlags([
      row('economy', 'maintenance'),
      row('nonsense', 'hidden'),
      null,
      'ikke et objekt',
      { module_id: 42, availability: 'hidden' },
      row('cycle', 'retired'),
    ]);
    expect(parsed).toEqual({ economy: 'maintenance', cycle: 'retired' });
  });

  it('kaster aldrig, uanset hvad der kommer ind', () => {
    for (const input of [null, undefined, 0, 'streng', {}, [undefined], [[]]]) {
      expect(() => parseModuleFlags(input)).not.toThrow();
      expect(parseModuleFlags(input)).toEqual({});
    }
  });

  it('accepterer hver eneste gyldige tilstand for et modul der kan slås fra', () => {
    for (const state of MODULE_AVAILABILITY_STATES) {
      expect(parseModuleFlags([row('food', state)])).toEqual({ food: state });
    }
  });
});

describe('resolveModuleAvailability — sikker fallback', () => {
  it('bruger den kompilerede tilstand, når serveren intet siger', () => {
    for (const moduleId of MODULE_IDS) {
      expect(resolveModuleAvailability(moduleId, {})).toBe(MODULE_AVAILABILITY[moduleId]);
    }
  });

  it('lader serverens flag vinde over den kompilerede tilstand', () => {
    expect(resolveModuleAvailability('travel', { travel: 'maintenance' })).toBe('maintenance');
  });

  it('holder et lukket modul lukket, når svaret er det sidst kendte fra disk', () => {
    // Præcis det scenarie en kill switch findes til: noget er i stykker, og
    // enheden er offline. Fallback må ikke være "luk op igen".
    const cached: ModuleFlagOverrides = { food: 'maintenance' };
    expect(resolveModuleAvailability('food', cached)).toBe('maintenance');
  });
});

describe('kill switch ende til ende', () => {
  it('lukker modulet, men ikke vejen til dataene', () => {
    const overrides = parseModuleFlags([row('warranties', 'maintenance')]);
    const access = evaluateModuleAccess(resolveModuleAvailability('warranties', overrides));

    expect(access.canCreate).toBe(false);
    expect(access.canEdit).toBe(false);
    expect(access.canViewExistingData).toBe(true);
    expect(access.canExportData).toBe(true);
    expect(access.canDeleteData).toBe(true);
  });

  it('bevarer eksport og sletning for hver tilstand serveren kan sende', () => {
    // Acceptkriteriet "read/export of existing data preserved" må gælde hele
    // vejen igennem den fjernstyrede sti, ikke kun i evaluatoren isoleret.
    for (const state of MODULE_AVAILABILITY_STATES) {
      const overrides = parseModuleFlags([row('travel', state)]);
      const access = evaluateModuleAccess(resolveModuleAvailability('travel', overrides));
      expect(access.canExportData).toBe(true);
      expect(access.canDeleteData).toBe(true);
    }
  });

  it('kan ikke spærre skallen, uanset hvad serveren sender', () => {
    for (const moduleId of PLATFORM_MODULE_IDS) {
      for (const state of MODULE_AVAILABILITY_STATES) {
        const overrides = parseModuleFlags([row(moduleId, state)]);
        const access = evaluateModuleAccess(resolveModuleAvailability(moduleId, overrides));
        expect(access.canOpenModule).toBe(true);
      }
    }
  });
});

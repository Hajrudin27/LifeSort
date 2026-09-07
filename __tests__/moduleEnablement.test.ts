import {
  canToggleModule,
  enabledModuleIds,
  isModuleEnabled,
  type ModuleEnablement,
  parseModuleEnablementRows,
  TOGGLEABLE_MODULE_IDS,
} from '@/core/modules/moduleEnablement';
import { evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import { getModule, MODULE_IDS, PLATFORM_MODULE_IDS } from '@/core/modules/moduleRegistry';

const row = (module_id: string, enabled: unknown) => ({ module_id, enabled });

describe('standardværdien', () => {
  it('slår alt til for en bruger der ikke har valgt endnu', () => {
    // En eksisterende bruger må ikke miste adgang til noget, hun allerede
    // bruger, fordi et nyt valg blev indført.
    for (const moduleId of MODULE_IDS) {
      expect(isModuleEnabled(moduleId, {})).toBe(true);
    }
    expect(enabledModuleIds({})).toEqual([...MODULE_IDS]);
  });

  it('lader et fravalg gælde', () => {
    expect(isModuleEnabled('travel', { travel: false })).toBe(false);
    expect(enabledModuleIds({ travel: false })).not.toContain('travel');
  });

  it('rører ikke de andre moduler, når ét slås fra', () => {
    const enablement: ModuleEnablement = { cycle: false };
    for (const moduleId of MODULE_IDS) {
      if (moduleId === 'cycle') continue;
      expect(isModuleEnabled(moduleId, enablement)).toBe(true);
    }
  });
});

describe('platformen kan ikke fravælges', () => {
  it('hverken gennem valget', () => {
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(canToggleModule(moduleId)).toBe(false);
      // Selv et eksplicit false skal ignoreres — ellers ville brugeren kunne
      // skjule sin egen vej til eksport og sletning.
      expect(isModuleEnabled(moduleId, { [moduleId]: false })).toBe(true);
    }
  });

  it('eller fra serveren', () => {
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(parseModuleEnablementRows([row(moduleId, false)])).toEqual({});
    }
  });

  it('og de står ikke på listen brugeren vælger fra', () => {
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(TOGGLEABLE_MODULE_IDS).not.toContain(moduleId);
    }
    expect(TOGGLEABLE_MODULE_IDS.length).toBe(MODULE_IDS.length - PLATFORM_MODULE_IDS.length);
  });
});

describe('parseModuleEnablementRows — svaret fra serveren er input udefra', () => {
  it('tager imod gyldige rækker', () => {
    expect(parseModuleEnablementRows([row('food', false), row('cycle', true)])).toEqual({
      food: false,
      cycle: true,
    });
  });

  it('ignorerer ukendte moduler og forkerte typer', () => {
    expect(parseModuleEnablementRows([row('quantum-banking', false)])).toEqual({});
    expect(parseModuleEnablementRows([row('food', 'nej')])).toEqual({});
    expect(parseModuleEnablementRows([row('food', 0)])).toEqual({});
  });

  it('kaster aldrig, uanset hvad der kommer ind', () => {
    for (const input of [null, undefined, 0, 'streng', {}, [null], [[]]]) {
      expect(() => parseModuleEnablementRows(input)).not.toThrow();
      expect(parseModuleEnablementRows(input)).toEqual({});
    }
  });

  it('lader tvivl falde ud til SLÅET TIL', () => {
    // Modsat kill switches, hvor tvivl lukker ned. Et ødelagt svar må ikke
    // kunne skjule brugerens egne data.
    const parsed = parseModuleEnablementRows([row('travel', 'ugyldig')]);
    expect(isModuleEnabled('travel', parsed)).toBe(true);
  });
});

describe('fravalg er ikke sletning', () => {
  it('rører ikke datarettighederne', () => {
    // Uanset valget er eksport og sletning stadig brugerens — se ADR-0004.
    for (const moduleId of MODULE_IDS) {
      const access = evaluateModuleAccess(getModule(moduleId).availability);
      expect(access.canExportData).toBe(true);
      expect(access.canDeleteData).toBe(true);
    }
  });

  it('er et rent filter, der kan vendes om', () => {
    // Slå fra, slå til igen: præcis samme tilstand. Et fravalg må ikke efterlade
    // spor, for så var det ikke bare et filter.
    const off: ModuleEnablement = { warranties: false };
    const backOn: ModuleEnablement = { ...off, warranties: true };
    expect(isModuleEnabled('warranties', backOn)).toBe(true);
    expect(enabledModuleIds(backOn)).toEqual(enabledModuleIds({}));
  });
});

describe('valget og modenhed er to forskellige spørgsmål', () => {
  it('siger intet om, om modulet er udgivet', () => {
    // Et fravalgt modul er stadig udgivet; en kill switch er stadig en kill
    // switch. Skærmene skal spørge om begge dele hver for sig.
    const access = evaluateModuleAccess(getModule('food').availability);
    expect(access.canOpenModule).toBe(true);
    expect(isModuleEnabled('food', { food: false })).toBe(false);
  });
});

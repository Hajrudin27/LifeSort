import {
  canToggleModule,
  discoverableToggleableModuleIds,
  defaultModuleEnabled,
  enabledModuleIds,
  isModuleEnabled,
  type ModuleEnablement,
  parseModuleEnablementRows,
  TOGGLEABLE_MODULE_IDS,
} from '@/core/modules/moduleEnablement';
import { resolveModuleAvailability } from '@/core/feature-flags/moduleFlags';
import { evaluateModuleAccess, MODULE_AVAILABILITY_STATES, type ModuleAvailability, PUBLIC_VIEWER } from '@/core/modules/moduleAvailability';
import {
  getModule,
  type ModuleDefinition,
  type ModuleId,
  MODULE_IDS,
  MODULE_REGISTRY,
  PLATFORM_MODULE_IDS,
} from '@/core/modules/moduleRegistry';

const row = (module_id: string, enabled: unknown) => ({ module_id, enabled });

const isHealth = (moduleId: ModuleId) => getModule(moduleId).sensitivity.includes('health');
const HEALTH_MODULE_IDS = TOGGLEABLE_MODULE_IDS.filter(isHealth);
const NON_HEALTH_MODULE_IDS = TOGGLEABLE_MODULE_IDS.filter((moduleId) => !isHealth(moduleId));

describe('standardværdien', () => {
  it('slår alt andet end helbred til for en bruger der ikke har valgt endnu', () => {
    // En eksisterende bruger må ikke miste adgang til noget, hun allerede
    // bruger, fordi et nyt valg blev indført.
    for (const moduleId of MODULE_IDS) {
      expect(isModuleEnabled(moduleId, {})).toBe(!HEALTH_MODULE_IDS.includes(moduleId));
    }
    expect(enabledModuleIds({})).toEqual(MODULE_IDS.filter((moduleId) => !HEALTH_MODULE_IDS.includes(moduleId)));
  });

  it('lader et fravalg gælde', () => {
    expect(isModuleEnabled('travel', { travel: false })).toBe(false);
    expect(enabledModuleIds({ travel: false })).not.toContain('travel');
  });

  it('rører ikke de andre moduler, når ét slås fra', () => {
    const enablement: ModuleEnablement = { cycle: false };
    for (const moduleId of NON_HEALTH_MODULE_IDS) {
      expect(isModuleEnabled(moduleId, enablement)).toBe(true);
    }
  });
});

describe('APP-071 — et helbredsmodul kræver et eksplicit valg', () => {
  it('Cyklus og Graviditet er helbredsmoduler, og de er de eneste i dag', () => {
    // Ændres det, skal det være bevidst: det flytter, hvem der har et helbredsmodul slået til.
    // Graviditet (APP-076 fase A) er intern og arver reglen af sin klassificering; den har ingen skærm endnu.
    expect(HEALTH_MODULE_IDS).toEqual(['cycle', 'pregnancy']);
  });

  it('standarden følger registrets klassificering for hvert eneste modul', () => {
    for (const moduleId of MODULE_IDS) {
      const expected = !canToggleModule(moduleId) || !isHealth(moduleId);
      expect(defaultModuleEnabled(moduleId)).toBe(expected);
    }
  });

  it('et helbredsmodul uden valg er slået fra', () => {
    expect(defaultModuleEnabled('cycle')).toBe(false);
    expect(isModuleEnabled('cycle', {})).toBe(false);
    expect(enabledModuleIds({})).not.toContain('cycle');
  });

  it('platformen er stadig slået til, uanset standarden', () => {
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(defaultModuleEnabled(moduleId)).toBe(true);
      expect(isModuleEnabled(moduleId, {})).toBe(true);
    }
  });

  it('et eksplicit true slår Cyklus til', () => {
    expect(isModuleEnabled('cycle', { cycle: true })).toBe(true);
    expect(enabledModuleIds({ cycle: true })).toContain('cycle');
  });

  it('et eksplicit false holder Cyklus slået fra', () => {
    expect(isModuleEnabled('cycle', { cycle: false })).toBe(false);
    expect(enabledModuleIds({ cycle: false })).not.toContain('cycle');
  });

  it('kan slås til, fra og til igen — og ender præcis som første gang', () => {
    const on: ModuleEnablement = { cycle: true };
    const off: ModuleEnablement = { ...on, cycle: false };
    const backOn: ModuleEnablement = { ...off, cycle: true };
    expect([on, off, backOn].map((enablement) => isModuleEnabled('cycle', enablement))).toEqual([true, false, true]);
    expect(enabledModuleIds(backOn)).toEqual(enabledModuleIds(on));
  });

  it('et valg for ét modul rører ikke standarden for de andre', () => {
    expect(isModuleEnabled('cycle', { travel: true })).toBe(false);
    expect(isModuleEnabled('travel', { cycle: true })).toBe(true);
    expect(isModuleEnabled('cycle', { economy: false, food: false })).toBe(false);
  });

  it('en række serveren ikke forstår, aktiverer ikke Cyklus', () => {
    for (const bad of ['ugyldig', null, 1, undefined]) {
      expect(isModuleEnabled('cycle', parseModuleEnablementRows([row('cycle', bad)]))).toBe(false);
    }
    expect(isModuleEnabled('cycle', parseModuleEnablementRows([row('cycle', true)]))).toBe(true);
    expect(isModuleEnabled('cycle', parseModuleEnablementRows([row('cycle', false)]))).toBe(false);
    expect(isModuleEnabled('cycle', parseModuleEnablementRows('ikke en liste'))).toBe(false);
  });

  it('et fremtidigt modul, der erklærer sensitivity "health", arver slået-fra uden ny kode', () => {
    // Graviditet findes ikke endnu (APP-076). Reglen skal ikke skrives igen, når det gør: den hænger på
    // klassificeringen. Et syntetisk modul lægges i registret og fjernes igen.
    const registry = MODULE_REGISTRY as Record<string, ModuleDefinition>;
    const futureHealth = 'future-health' as ModuleId;
    const futureMixed = 'future-mixed' as ModuleId;
    const futureOrdinary = 'future-ordinary' as ModuleId;
    const base: Omit<ModuleDefinition, 'id' | 'sensitivity'> = { availability: 'available', titleKey: 't', descriptionKey: 'd', routeRoots: [] };
    registry[futureHealth] = { ...base, id: futureHealth, sensitivity: ['health'] };
    registry[futureMixed] = { ...base, id: futureMixed, sensitivity: ['personal', 'health', 'document'] };
    registry[futureOrdinary] = { ...base, id: futureOrdinary, sensitivity: ['ordinary', 'personal'] };
    try {
      expect(defaultModuleEnabled(futureHealth)).toBe(false);
      expect(isModuleEnabled(futureHealth, {})).toBe(false);
      expect(isModuleEnabled(futureHealth, { [futureHealth]: true })).toBe(true);
      expect(isModuleEnabled(futureHealth, { [futureHealth]: false })).toBe(false);
      expect(defaultModuleEnabled(futureMixed)).toBe(false);
      expect(defaultModuleEnabled(futureOrdinary)).toBe(true);
    } finally {
      delete registry[futureHealth];
      delete registry[futureMixed];
      delete registry[futureOrdinary];
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

describe('public module discovery respects the registry maturity ceiling', () => {
  it('hides every internal module while retaining ordinary released choices', () => {
    const visible = discoverableToggleableModuleIds();
    expect(visible).not.toContain('pregnancy');
    expect(visible).not.toContain('gifts');
    expect(visible).toContain('travel');
  });

  it('cannot promote an internal module through a remote flag, but can restrict a released one', () => {
    expect(discoverableToggleableModuleIds({ pregnancy: 'available', gifts: 'beta' })).not.toEqual(expect.arrayContaining(['pregnancy', 'gifts']));
    expect(discoverableToggleableModuleIds({ travel: 'hidden' })).not.toContain('travel');
  });
});

describe('the shared evaluator treats registry maturity as a ceiling for EVERY declared state', () => {
  const CAPABILITIES = ['showInNavigation', 'canOpenModule', 'canViewExistingData', 'canCreate', 'canEdit'] as const;
  const VIEWERS = [PUBLIC_VIEWER, { isInternalUser: false, isBetaTester: true }, { isInternalUser: true, isBetaTester: false }];

  /** Economy is only the carrier: its declared state is set for one assertion and restored. */
  const withDeclared = (declared: ModuleAvailability, run: () => void) => {
    const definition = MODULE_REGISTRY.economy as { availability: ModuleAvailability };
    const original = definition.availability;
    definition.availability = declared;
    try { run(); } finally { definition.availability = original; }
  };

  it('never grants a viewer any capability the declared state withholds, whatever the remote flag says', () => {
    const violations: string[] = [];
    for (const declared of MODULE_AVAILABILITY_STATES) {
      withDeclared(declared, () => {
        for (const requested of MODULE_AVAILABILITY_STATES) {
          const effective = resolveModuleAvailability('economy', { economy: requested });
          VIEWERS.forEach((viewer, index) => {
            const ceiling = evaluateModuleAccess(declared, viewer);
            const actual = evaluateModuleAccess(effective, viewer);
            for (const capability of CAPABILITIES) {
              if (actual[capability] && !ceiling[capability]) violations.push(`${declared} + remote ${requested} => ${effective}: viewer#${index} gains ${capability}`);
            }
          });
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('keeps a retired module retired and a maintenance module without create/edit', () => {
    withDeclared('retired', () => {
      for (const requested of MODULE_AVAILABILITY_STATES) expect(resolveModuleAvailability('economy', { economy: requested })).toBe('retired');
    });
    withDeclared('maintenance', () => {
      expect(resolveModuleAvailability('economy', { economy: 'available' })).toBe('maintenance');
      expect(resolveModuleAvailability('economy', { economy: 'beta' })).toBe('maintenance');
      expect(resolveModuleAvailability('economy', { economy: 'retired' })).toBe('retired');
    });
    // The flag still restricts a released module, so the kill switch keeps working.
    withDeclared('available', () => {
      for (const requested of MODULE_AVAILABILITY_STATES) expect(resolveModuleAvailability('economy', { economy: requested })).toBe(requested);
    });
  });

  it('no flag promotes any currently internal module (Pregnancy, Gifts) beyond internal', () => {
    for (const moduleId of ['pregnancy', 'gifts'] as const) {
      expect(MODULE_REGISTRY[moduleId].availability).toBe('internal');
      for (const requested of ['beta', 'available', 'maintenance'] as const) {
        expect(resolveModuleAvailability(moduleId, { [moduleId]: requested })).toBe('internal');
      }
    }
  });
});

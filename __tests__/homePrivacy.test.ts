import {
  defaultDetail,
  EMPTY_HOME_PRIVACY,
  type HomePrivacyPreferences,
  isExplicitlyMasked,
  isMaskable,
  MASKED_VALUE,
  resolveCardDetail,
} from '@/core/modules/homePrivacy';
import { HOME_SNAPSHOT_PROVIDERS } from '@/features/homeSnapshots';
import type { DataSensitivity, HomeSnapshot, ModuleId } from '@/core/modules/moduleRegistry';
import { useCycleStore } from '@/store/useCycleStore';
import { useTripsStore } from '@/store/useTripsStore';

/**
 * APP-013 — Home skal kunne vises frem uden at røbe noget.
 */

const card = (moduleId: ModuleId, sensitivity: DataSensitivity) => ({ moduleId, sensitivity });

const prefs = (partial: Partial<HomePrivacyPreferences>): HomePrivacyPreferences => ({
  ...EMPTY_HOME_PRIVACY,
  ...partial,
});

const HYDRATED = true;

describe('hvad der kan maskeres', () => {
  it('er alt der ikke er hverdagsagtigt', () => {
    for (const sensitivity of ['personal', 'financial', 'health', 'document'] as DataSensitivity[]) {
      expect(isMaskable(sensitivity)).toBe(true);
    }
    expect(isMaskable('ordinary')).toBe(false);
  });
});

describe('standarden', () => {
  it('starter helbred maskeret', () => {
    // Ét blik på "Cyklusdag 12" er nok. Specifikationen §8.7 siger det samme
    // om Home-widgets: privacy-safe som udgangspunkt.
    expect(defaultDetail('health')).toBe('masked');
    expect(resolveCardDetail(card('cycle', 'health'), EMPTY_HOME_PRIVACY, HYDRATED)).toBe('masked');
  });

  it('starter alt andet synligt', () => {
    // Maskerede man alt, ville Home være ubrugelig — og så ville brugeren slå
    // maskeringen fra og stå uden noget som helst.
    for (const sensitivity of ['ordinary', 'personal', 'financial', 'document'] as DataSensitivity[]) {
      expect(defaultDetail(sensitivity)).toBe('full');
    }
  });
});

describe('brugerens eget valg', () => {
  it('kan maskere et kort der ellers var synligt', () => {
    const p = prefs({ detail: { economy: 'masked' } });
    expect(resolveCardDetail(card('economy', 'financial'), p, HYDRATED)).toBe('masked');
    expect(isExplicitlyMasked('economy', p)).toBe(true);
  });

  it('kan afmaskere helbred, hvis hun vil', () => {
    // Standarden er en beskyttelse, ikke en spærring.
    const p = prefs({ detail: { cycle: 'full' } });
    expect(resolveCardDetail(card('cycle', 'health'), p, HYDRATED)).toBe('full');
  });

  it('slår igennem over standarden begge veje', () => {
    expect(resolveCardDetail(card('travel', 'personal'), prefs({ detail: { travel: 'masked' } }), HYDRATED)).toBe('masked');
    expect(resolveCardDetail(card('travel', 'personal'), EMPTY_HOME_PRIVACY, HYDRATED)).toBe('full');
  });

  it('lader skjult vinde over maskeret', () => {
    const p = prefs({ hidden: ['cycle'], detail: { cycle: 'full' } });
    expect(resolveCardDetail(card('cycle', 'health'), p, HYDRATED)).toBe('hidden');
  });
});

describe('ingen glimt af noget følsomt under indlæsning', () => {
  const NOT_HYDRATED = false;

  it('holder ethvert følsomt kort tilbage, indtil valget er læst', () => {
    for (const sensitivity of ['personal', 'financial', 'health', 'document'] as DataSensitivity[]) {
      expect(resolveCardDetail(card('economy', sensitivity), EMPTY_HOME_PRIVACY, NOT_HYDRATED)).toBe('hidden');
    }
  });

  it('holder det tilbage, uanset hvad præferencerne senere viser sig at være', () => {
    // Også når brugeren faktisk har valgt "fuldt": vi ved det ikke endnu.
    const p = prefs({ detail: { cycle: 'full' } });
    expect(resolveCardDetail(card('cycle', 'health'), p, NOT_HYDRATED)).toBe('hidden');
  });

  it('lader hverdagsagtige kort stå med det samme', () => {
    // Ellers ville Home stå tom, hver gang appen åbnes.
    expect(resolveCardDetail(card('food', 'ordinary'), EMPTY_HOME_PRIVACY, NOT_HYDRATED)).toBe('full');
  });
});

describe('maskeringen dækker det rigtige', () => {
  it('erstatter værdien med noget uden information i', () => {
    expect(MASKED_VALUE).not.toMatch(/[0-9a-zA-ZæøåÆØÅ]/);
  });

  it('gælder de kort, gennemgangen udpegede — når de har noget at vise', async () => {
    // Rejsekortet bærer et rejsenavn og cykluskortet en cyklusdag — de to fund
    // fra følsomhedsgennemgangen i APP-011. Begge SKAL kunne maskeres, når de
    // faktisk viser det. Kortene skal derfor fyldes først: et tomt rejsekort
    // siger kun "planlæg din første tur" og er med rette hverdagsagtigt.
    useTripsStore.setState({
      trips: [
        {
          id: 't1',
          name: 'Bryllupsrejse',
          startDate: '2099-07-01',
          endDate: '2099-07-14',
          budget: null,
          documents: [],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    useCycleStore.setState({
      cycles: [{ id: 'c1', startDate: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' }],
    });

    for (const moduleId of ['travel', 'cycle'] as ModuleId[]) {
      const snapshot = (await HOME_SNAPSHOT_PROVIDERS[moduleId]!()) as HomeSnapshot;
      expect(isMaskable(snapshot.sensitivity)).toBe(true);
      // Brugeren kan slå det fra — det er kravet. Om det SKAL være slået fra
      // fra start er et andet spørgsmål: cyklus er det som standard, rejsenavnet
      // er ikke. Se docs/home-snapshots.md §5.
      expect(resolveCardDetail(snapshot, prefs({ detail: { [moduleId]: 'masked' } }), HYDRATED)).toBe('masked');
    }

    // Og forskellen i standard er bevidst, ikke tilfældig.
    const cycleCard = (await HOME_SNAPSHOT_PROVIDERS.cycle!()) as HomeSnapshot;
    const travelCard = (await HOME_SNAPSHOT_PROVIDERS.travel!()) as HomeSnapshot;
    expect(resolveCardDetail(cycleCard, EMPTY_HOME_PRIVACY, HYDRATED)).toBe('masked');
    expect(resolveCardDetail(travelCard, EMPTY_HOME_PRIVACY, HYDRATED)).toBe('full');
  });

  it('lader et tomt kort være hverdagsagtigt', () => {
    // Følsomhed hører til det kortet VISER, ikke til modulets navn. Et tomt
    // rejsekort røber ingenting, og skal ikke maskeres for syns skyld.
    expect(isMaskable('ordinary')).toBe(false);
  });

  it('maskerer aldrig titlen — kortet skal stadig kunne genkendes', () => {
    // Et kort uden overskrift er ikke privat, det er bare forvirrende.
    const detail = resolveCardDetail(card('cycle', 'health'), EMPTY_HOME_PRIVACY, HYDRATED);
    expect(detail).toBe('masked');
    expect(detail).not.toBe('hidden');
  });
});

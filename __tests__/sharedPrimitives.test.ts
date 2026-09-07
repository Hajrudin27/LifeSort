/// <reference types="node" />

import fs from 'fs';
import path from 'path';

/**
 * APP-008 — fryser dubletterne af de fælles primitiver.
 *
 * Hver liste herunder er de steder, der i dag implementerer et primitiv for sig
 * selv. Listerne må kun blive kortere: en ny kopi fejler med det samme, og
 * fjerner man en gammel, fejler testen indtil linjen er væk herfra.
 *
 * Tilføj ALDRIG en linje for at få testen til at blive grøn — så er
 * beskyttelsen væk netop dér, hvor den næste afvigelse opstår. Se
 * docs/shared-primitives.md og ADR-0008.
 */

const REPO_ROOT = path.resolve(__dirname, '..');

/** Den stærkere af de to id-generatorer. Kopieret ordret. */
const ID_GENERATOR_TIMESTAMP_RANDOM = [
  'store/useCVStore.ts',
  'store/useCareerStore.ts',
  'store/useCycleStore.ts',
  'store/useFoodStore.ts',
  'store/useHabitsStore.ts',
  'store/useHouseholdStore.ts',
  'store/useLifeGoalsStore.ts',
  'store/useSavingsGoalsStore.ts',
  'store/useTodoStore.ts',
  'store/useTripsStore.ts',
  'utils/shared/attachmentStorage.ts',
];

/** Den svage variant: kolliderer inden for samme millisekund. */
const ID_GENERATOR_TIMESTAMP_ONLY = [
  'components/AttachmentList.tsx',
  'components/TripAttachmentGrid.tsx',
  'store/useExpensesStore.ts',
  'store/useSavingsGoalsStore.ts',
  'store/useWarrantiesStore.ts',
];

/** Fire moduler der hver især planlægger en lokal notifikation. */
const REMINDER_MODULES = [
  'utils/cycle/cycleReminder.ts',
  'utils/expense/incomeReminder.ts',
  'utils/trip/tripReminder.ts',
  'utils/warranty/warrantyReminder.ts',
];

/** Typer med en vedhæftnings-form. To i dag; den ene mangler storagePath. */
const ATTACHMENT_TYPE_FILES = ['types/attachment.ts', 'types/trip.ts'];

/** Skærme der formaterer beløb selv, i stedet for gennem et Money-primitiv. */
const MONEY_FORMATTING_FILES = [
  'app/(tabs)/economy.tsx',
  'app/economy/insights.tsx',
  'app/expenses/search.tsx',
  'app/expenses/upcoming.tsx',
  'app/food/index.tsx',
  'app/food/offers.tsx',
  'app/food/recipes/[id].tsx',
  'app/food/weekly-plan.tsx',
  'app/savings/[id].tsx',
  'app/savings/allocate.tsx',
  'app/savings/icon/[icon].tsx',
  'app/savings/index.tsx',
  'app/travel/[id]/expenses/index.tsx',
  'app/travel/[id]/index.tsx',
  'app/travel/index.tsx',
  'components/ExpensePieChart.tsx',
  // APP-011 flyttede Homes beløbsformatering herind. Den forsvandt ikke —
  // den flyttede, og skal med i frysningen, hvor den nu står.
  'features/economy/homeSnapshot.ts',
  'features/food/homeSnapshot.ts',
];

function sourceFiles(dirs: string[]): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) found.push(path.relative(REPO_ROOT, full));
    }
  };
  for (const dir of dirs) walk(path.join(REPO_ROOT, dir));
  return found.sort();
}

function filesMatching(dirs: string[], pattern: RegExp): string[] {
  return sourceFiles(dirs).filter((file) => pattern.test(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')));
}

/** Fælles ratchet: hverken nye kopier eller forældede undtagelser. */
function expectFrozen(actual: string[], baseline: string[], what: string) {
  const added = actual.filter((file) => !baseline.includes(file));
  if (added.length > 0) {
    throw new Error(
      `Ny kopi af ${what}:\n${added.map((file) => `  ${file}`).join('\n')}\n\n` +
        'Brug det fælles primitiv i stedet — se docs/shared-primitives.md.',
    );
  }

  const stale = baseline.filter((file) => !actual.includes(file));
  if (stale.length > 0) {
    throw new Error(
      `Disse er ikke længere kopier af ${what}:\n${stale.map((file) => `  ${file}`).join('\n')}\n\n` +
        'Fjern dem fra listen i denne test, så den bliver ved med at skrumpe.',
    );
  }
}

describe('EntityId', () => {
  it('får ingen nye kopier af tidsstempel-plus-tilfældigt id', () => {
    const actual = filesMatching(
      ['store', 'utils', 'components', 'app'],
      /Date\.now\(\)\}-\$\{Math\.round\(Math\.random/,
    );
    expectFrozen(actual, ID_GENERATOR_TIMESTAMP_RANDOM, 'id-generatoren `${Date.now()}-${Math.random()}`');
  });

  it('får ingen nye kopier af den variant der kan kollidere', () => {
    // Date.now().toString() har kun millisekund-opløsning. AttachmentList laver
    // tre id'er i træk på den måde.
    const actual = filesMatching(['store', 'utils', 'components', 'app'], /Date\.now\(\)\.toString\(\)/);
    expectFrozen(actual, ID_GENERATOR_TIMESTAMP_ONLY, 'id-generatoren `Date.now().toString()`');
  });
});

describe('Reminder', () => {
  it('får ikke et femte påmindelsesmodul', () => {
    const actual = sourceFiles(['utils']).filter((file) => file.endsWith('Reminder.ts'));
    expectFrozen(actual, REMINDER_MODULES, 'påmindelses-modulet');
  });

  it('husker at cykel-påmindelsen er den eneste uden permission-kald', () => {
    // Den virker kun, fordi indkomst-påmindelsen spørger først ved opstart.
    // Fjernes den asymmetri, skal linjen her væk — og så er fejlen rettet.
    const asksForPermission = REMINDER_MODULES.filter((file) =>
      /requestPermissionsAsync/.test(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')),
    );
    expect(asksForPermission).toEqual([
      'utils/expense/incomeReminder.ts',
      'utils/trip/tripReminder.ts',
      'utils/warranty/warrantyReminder.ts',
    ]);
  });
});

describe('AttachmentRef', () => {
  it('får ikke en tredje vedhæftnings-type', () => {
    const actual = sourceFiles(['types']).filter((file) =>
      /kind:\s*(AttachmentKind|['"]image['"]\s*\|\s*['"]document['"])/.test(
        fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'),
      ),
    );
    expectFrozen(actual, ATTACHMENT_TYPE_FILES, 'vedhæftnings-typen');
  });

  it('holder fast i at rejser mangler i sync-stien', () => {
    // Bevis for konsekvensen i docs/shared-primitives.md §5: uden 'trip' her
    // bliver rejse-filer aldrig uploadet. Ryger 'trip' ind, er fejlen rettet,
    // og så skal denne test opdateres sammen med dokumentet.
    const sync = fs.readFileSync(path.join(REPO_ROOT, 'utils/shared/attachmentSync.ts'), 'utf8');
    expect(sync).toContain("export type AttachmentOwnerType = 'warranty' | 'expense';");
  });
});

describe('Money', () => {
  it('får ikke flere skærme der formaterer beløb selv', () => {
    const actual = filesMatching(['app', 'components', 'features'], /toFixed\(/);
    expectFrozen(actual, MONEY_FORMATTING_FILES, 'lokal beløbsformatering (`toFixed`)');
  });
});

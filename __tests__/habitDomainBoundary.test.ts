/// <reference types="node" />
import fs from 'fs';
import path from 'path';

/**
 * APP-064 dependency direction (ADR-0003, ADR-0052, docs/core-contract.md): a module may depend on
 * core; core may never depend on a module. The platform-wide "no import of a feature" guard is in
 * goalDomainBoundary.test.ts and covers the new core/habits file too; this file holds the
 * Habits-specific shape of the split:
 *
 *   core/habits/persistedHabit.ts     the persisted FORMAT only (the documented C2 exception), clock-free
 *   features/habits/domain/*          the live rules; imports core, never the reverse
 */
const ROOT = path.resolve(__dirname, '..');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
const importsOf = (file: string) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
const listFiles = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  : [];
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const code = (file: string) => stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const sourceFiles = (...dirs: string[]) => dirs.flatMap((dir) => listFiles(path.join(ROOT, dir))).filter((file) => /\.(ts|tsx)$/.test(file));

describe('APP-064 Habit persisted-format contract (core/habits)', () => {
  const FILE = 'core/habits/persistedHabit.ts';

  it('depends only on shared entity types and the calendar primitive', () => {
    expect(importsOf(path.join(ROOT, FILE)).sort()).toEqual(['@/types/life', '@/utils/shared/localDate']);
  });

  it('never reads the clock: a decoder that answered "is this in the future?" would give different answers on different days', () => {
    const text = code(FILE);
    expect(text).not.toMatch(/Date\.now\(|new Date\(|todayIso|toLocalIsoDate|getTimezoneOffset|getDay\(/);
  });

  it('carries the format and the frozen legacy mapping, not the Habits module\'s live rules', () => {
    const text = code(FILE);
    for (const live of ['habitDayStatus', 'habitWeekFacts', 'scheduleOn', 'isScheduledOn', 'withSchedule', 'withDateCompleted',
      'buildHabit', 'scheduleChangeEffectiveFrom', 'decodeRemoteHabitRow', 'habitToRow', 'HabitError', 'parseWeeklyTarget']) {
      expect(text).not.toContain(live);
    }
    expect(text).toContain('decodeLegacyHabit');
    expect(text).toContain('decodeHabit');
    expect(text).toContain('decodeScheduleHistory');
  });

  it('is imported by exactly the migration, the backup parser and the Habits domain', () => {
    const importers = sourceFiles('core', 'features', 'store', 'app', 'utils', 'components', 'hooks', 'lib')
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('@/core/habits')))
      .map(rel);
    expect([...new Set(importers)].sort()).toEqual([
      'core/storage/migrations/habits.ts',
      'features/habits/domain/habitCommands.ts',
      'features/habits/domain/habitInput.ts',
      'features/habits/domain/habitRow.ts',
      'utils/shared/backupValidation.ts',
    ]);
  });
});

describe('APP-064 Habit domain (features/habits/domain)', () => {
  const DIR = path.join(ROOT, 'features/habits/domain');
  const files = listFiles(DIR).filter((file) => file.endsWith('.ts'));
  /** Inward and shared only: the core contract, entity types, the calendar primitive, itself. */
  const ALLOWED = [/^\.\/habit(Status|Commands|Row|Input|Streak|PeriodSummary)$/, /^@\/features\/habits\/domain\/habit(Status|Commands|Row|Input|Streak|PeriodSummary)$/,
    /^@\/core\/habits\/persistedHabit$/, /^@\/types\/life$/, /^@\/utils\/shared\/localDate$/];

  it('finds the domain files', () => {
    expect(files.map((file) => path.basename(file)).sort()).toEqual(['habitCommands.ts', 'habitInput.ts', 'habitPeriodSummary.ts', 'habitRow.ts', 'habitStatus.ts', 'habitStreak.ts']);
  });

  it('is a pure leaf: no store, UI, routes, sync, money, i18n or network', () => {
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        expect({ file: path.basename(file), specifier, allowed: ALLOWED.some((rule) => rule.test(specifier)) })
          .toEqual({ file: path.basename(file), specifier, allowed: true });
      }
    }
  });

  it('has no hidden clock: "today" is always a parameter, never read', () => {
    for (const file of files) {
      expect({ file: path.basename(file), clock: /Date\.now\(|new Date\(\)|todayIso|toLocalIsoDate|new Date\(\s*['"`]?\d{4}-/.test(stripComments(fs.readFileSync(file, 'utf8'))) })
        .toEqual({ file: path.basename(file), clock: false });
    }
  });

  it('takes the weekday from integer arithmetic, never from getDay() on a stored date', () => {
    for (const file of [...files, path.join(ROOT, 'core/habits/persistedHabit.ts')]) {
      expect(stripComments(fs.readFileSync(file, 'utf8'))).not.toMatch(/\.getDay\(|parseIsoDate/);
    }
  });

  it('is imported only by the Habits module, its screens, the Life and Home tabs, and the cycle card that reads outcomes', () => {
    const importers = sourceFiles('core', 'features', 'store', 'app', 'utils', 'components', 'hooks', 'lib')
      .filter((file) => !file.includes(`${path.sep}features${path.sep}habits${path.sep}domain${path.sep}`))
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('@/features/habits')))
      .map(rel).sort();
    expect(importers).toEqual([
      'app/(tabs)/index.tsx',
      'app/(tabs)/life.tsx',
      'app/habits/[id].tsx',
      'app/habits/index.tsx',
      'app/habits/new.tsx',
      'components/CycleInsightsCard.tsx',
      'components/HabitDayCell.tsx',
      'components/HabitMonthCalendar.tsx',
      'components/HabitPeriodSummaryCard.tsx',
      'components/HabitScheduleChooser.tsx',
      'components/HabitStreakCard.tsx',
      'components/HabitWeekRow.tsx',
      'features/habits/habitDisplay.ts',
      // Loads features/habits/habitRemoval.ts (it imports stores only, not the domain).
      'features/localStores.ts',
      'store/useHabitsStore.ts',
    ].sort());
  });

  it('keeps the cycle insights free of any Habits schedule knowledge: they take plain dated outcomes', () => {
    const text = code('utils/cycle/cycleInsights.ts');
    expect(importsOf(path.join(ROOT, 'utils/cycle/cycleInsights.ts')).some((specifier) => specifier.includes('habit'))).toBe(false);
    expect(text).not.toMatch(/scheduleHistory|HabitSchedule|HabitLog|scheduledDayOutcomes|isScheduledOn/);
    expect(text).toContain('DatedOutcome');
  });
});

describe('APP-064/APP-065 streaks are optional, per habit, and live in one closed place', () => {
  /** The only runtime files allowed to mention a streak. Everything else (Home, Life, review, Cycle, Search, the list) stays streak-free. */
  const UNRELATED_CYCLE_FILE = 'utils/cycle/symptomPatterns.ts';
  const STREAK_OWNERS = [
    'app/habits/[id].tsx',
    'components/HabitStreakCard.tsx',
    'core/storage/dataProfileRegistry.ts',
    'features/habits/domain/habitStreak.ts',
    // Pre-existing, unrelated: Cycle's symptom-months-in-a-row wording. Not an APP-065 owner (pinned below).
    UNRELATED_CYCLE_FILE,
    'store/useHabitPreferencesStore.ts',
  ];

  it('mentions a streak only in the closed allowlist, and the old helper is still gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'utils/habit/habitStreak.ts'))).toBe(false);
    const offenders = sourceFiles('app', 'components', 'features', 'store', 'utils', 'hooks', 'core', 'lib')
      .filter((file) => /streak|getCurrentStreak|hasLoggedToday|getLoggedThisWeek/i.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map(rel).sort();
    expect(offenders).toEqual([...STREAK_OWNERS].sort());
  });

  it('lets only the streak card import the streak helper, and only the card, the logout registry and the removal link the preference store', () => {
    const importing = (needle: RegExp) => sourceFiles('app', 'components', 'features', 'store', 'utils', 'hooks', 'core', 'lib')
      .filter((file) => importsOf(file).some((specifier) => needle.test(specifier))).map(rel).sort();
    expect(importing(/habitStreak$/)).toEqual(['components/HabitStreakCard.tsx']);
    expect(importing(/useHabitPreferencesStore$/)).toEqual([
      'components/HabitStreakCard.tsx', 'features/habits/habitRemoval.ts', 'features/localStores.ts']);
  });

  it('pins the one unrelated Cycle exception: it uses nothing from Habits or the streak code', () => {
    expect(importsOf(path.join(ROOT, UNRELATED_CYCLE_FILE)).filter((specifier) => /habit|Preferences/i.test(specifier))).toEqual([]);
  });

  it('keeps Home, Life, the monthly review, Cycle, Search and the Habits list free of streaks', () => {
    for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/life.tsx', 'app/habits/index.tsx', 'app/habits/new.tsx', 'app/review.tsx',
      'features/habits/monthlyReview.ts', 'utils/cycle/cycleInsights.ts', 'components/CycleInsightsCard.tsx', 'components/HabitWeekRow.tsx']) {
      expect({ file, streak: /streak/i.test(code(file)) }).toEqual({ file, streak: false });
    }
    const search = sourceFiles('core', 'app', 'features').map(rel).filter((file) => /search/i.test(file));
    for (const file of search) expect({ file, streak: /streak/i.test(code(file)) }).toEqual({ file, streak: false });
  });

  it('maps Habits to no flame icon anywhere: a flame is the streak symbol, and an icon needs no word to say it', () => {
    const offenders = sourceFiles('app', 'components', 'features', 'hooks', 'core')
      .filter((file) => /habits?['"]?\s*[:=][^\n]{0,200}(flame|fire_department)|key:\s*'habits'[\s\S]{0,200}(flame|fire_department)/i.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders).toEqual([]);
    // The two places that name a Habits icon: the modules launcher and the Life tab.
    expect(code('app/modules.tsx')).toMatch(/habits:\s*\{\s*ios:\s*'checkmark\.circle\.fill'/);
    expect(code('app/(tabs)/life.tsx')).not.toMatch(/flame|fire_department/);
    expect(code('app/(tabs)/index.tsx')).not.toMatch(/flame|fire_department/);
  });

  it('has no streak, restart or broken-chain wording in the Habits, Life, Home or module strings (EN and DA)', () => {
    const wording = /streak|restart|broken|bad day|failed|failure|i træk|dage i træk|bedste|start din/i;
    const streakCopyWording = /\blost\b|\blose\b|broke|broken|restart|reset|don't break|save your|fail|behind|bad day|pressure|\bbest\b|longest|record|🔥|mistet|brudt|brød|nulstil|genstart|fejl|bagud|dårlig dag|\bbedste\b|længste|rekord|i træk/i;
    const offenders: string[] = [];
    for (const lang of ['en', 'da']) {
      for (const name of ['habits', 'life', 'home', 'modules']) {
        const text = fs.readFileSync(path.join(ROOT, `localization/locales/${lang}/${name}.json`), 'utf8');
        const flat = (value: unknown, prefix: string): string[] => typeof value === 'string' ? [`${prefix}=${value}`]
          : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => flat(inner, `${prefix}.${key}`)) : [];
        for (const entry of flat(JSON.parse(text), `${lang}.${name}`)) {
          const [key, ...rest] = entry.split('=');
          const isHabitCopy = name === 'habits' || /habit/i.test(key);
          // The one place the word "streak" is allowed is the optional-streak copy, which has its own, stricter-in-spirit list.
          const pattern = key.startsWith(`${lang}.habits.streak.`) ? streakCopyWording : wording;
          if (isHabitCopy && pattern.test(rest.join('='))) offenders.push(entry);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no longer has the removed copy keys', () => {
    for (const lang of ['en', 'da']) {
      const habits = JSON.parse(fs.readFileSync(path.join(ROOT, `localization/locales/${lang}/habits.json`), 'utf8'));
      for (const key of ['streakLabel', 'logToday', 'loggedToday', 'weekLabel', 'targetLabel']) expect(habits).not.toHaveProperty(key);
      const life = JSON.parse(fs.readFileSync(path.join(ROOT, `localization/locales/${lang}/life.json`), 'utf8'));
      for (const key of ['topStreakLabel', 'topStreakHelper']) expect(life).not.toHaveProperty(key);
      const home = JSON.parse(fs.readFileSync(path.join(ROOT, `localization/locales/${lang}/home.json`), 'utf8'));
      expect(home).not.toHaveProperty('heroStreak');
    }
  });
});

describe('APP-066 the period summary is Habits-only, derived, and consumed by exactly one card', () => {
  const HELPER = 'features/habits/domain/habitPeriodSummary.ts';
  const CARD = 'components/HabitPeriodSummaryCard.tsx';
  const everything = () => sourceFiles('app', 'components', 'features', 'store', 'utils', 'hooks', 'core', 'lib');

  it('is imported by exactly the summary card, and the card by exactly the Habits list', () => {
    const importing = (needle: RegExp) => everything().filter((file) => importsOf(file).some((specifier) => needle.test(specifier))).map(rel).sort();
    expect(importing(/habitPeriodSummary$/)).toEqual([CARD]);
    expect(importing(/HabitPeriodSummaryCard$/)).toEqual(['app/habits/index.tsx']);
  });

  it('imports only Habit types and the calendar primitive (domain) and a closed set of UI pieces (card)', () => {
    expect(importsOf(path.join(ROOT, HELPER)).sort()).toEqual(['./habitStatus', '@/types/life', '@/utils/shared/localDate']);
    expect(importsOf(path.join(ROOT, CARD)).sort()).toEqual([
      '@/components/Card', '@/components/Chip', '@/components/Themed', '@/features/habits/domain/habitPeriodSummary', '@/types/life',
      'react', 'react-i18next', 'react-native',
    ]);
  });

  it('does not depend on Goals, Home, Life, Cycle, the monthly review, streaks, a store, persistence, the network or an AI SDK', () => {
    for (const file of [HELPER, CARD]) {
      const specifiers = importsOf(path.join(ROOT, file)).filter((specifier) => specifier !== '@/types/life'); // the entity types, not the Life tab
      expect({ file, bad: specifiers.filter((specifier) => /goal|home|life|cycle|monthlyReview|review|streak|preferences|store|storage|async-storage|supabase|sync|fetch|anthropic|openai|\bai\b/i.test(specifier)) })
        .toEqual({ file, bad: [] });
      expect({ file, text: /useLifeGoalsStore|LifeGoal|goalProgress|scheduledDayOutcomes|habitWeekFacts|habitsMonthlyReview|AsyncStorage|fetch\(|streak|flame|fire_department/i.test(code(file)) })
        .toEqual({ file, text: false });
    }
  });

  it('has no clock, no getDay() and no parse of a stored date', () => {
    for (const file of [HELPER, CARD]) {
      expect({ file, bad: /Date\.now\(|new Date\(|todayIso|toLocalIsoDate|parseIsoDate|\.getDay\(|getTimezoneOffset|Math\.random/.test(code(file)) }).toEqual({ file, bad: false });
    }
  });

  it('does no percentage arithmetic and exposes no score, rate, best or missed field', () => {
    for (const file of [HELPER, CARD]) {
      expect({ file, bad: /percent|\*\s*100|toFixed|\bscore\b|\brate\b|\bbest\b|\bmissed\b|progress/i.test(code(file)) }).toEqual({ file, bad: false });
    }
  });

  it('leaves Home, Life, the monthly review, Cycle and the old week helper without the summary', () => {
    for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/life.tsx', 'app/review.tsx', 'features/habits/monthlyReview.ts', 'core/modules/monthlyReview.ts',
      'utils/cycle/cycleInsights.ts', 'components/CycleInsightsCard.tsx', 'features/habits/domain/habitStatus.ts']) {
      expect({ file, uses: /habitPeriodSummary|HabitPeriodSummary/.test(code(file)) }).toEqual({ file, uses: false });
    }
  });

  it('adds no store, key, backup field or database object: nothing about the summary is persisted', () => {
    expect(everything().filter((file) => /habitPeriodSummary|HabitPeriodSummary|habits\.summary/.test(code(rel(file)))).map(rel).sort())
      .toEqual([CARD, HELPER, 'app/habits/index.tsx'].sort());
    for (const file of ['core/storage/dataProfileRegistry.ts', 'utils/shared/backupValidation.ts', 'utils/shared/dataBackup.ts', 'store/useHabitsStore.ts']) {
      expect({ file, uses: /period.?summary/i.test(code(file)) }).toEqual({ file, uses: false });
    }
    const sql = listFiles(path.join(ROOT, 'supabase')).filter((file) => /\.sql$/.test(file));
    expect(sql.filter((file) => /period_summary|habit_summary/i.test(fs.readFileSync(file, 'utf8')))).toEqual([]);
  });
});

describe('APP-064 the old model is gone from the live code', () => {
  it('uses targetPerWeek only to read legacy data, and the toggle nowhere', () => {
    const files = sourceFiles('app', 'components', 'features', 'store', 'utils', 'hooks', 'core', 'lib').map(rel).sort();
    expect(files.filter((file) => /toggleLogForDate/.test(code(file)))).toEqual([]);
    expect(files.filter((file) => /targetPerWeek/.test(code(file)))).toEqual([
      'core/habits/persistedHabit.ts',
      'core/storage/dataProfileRegistry.ts', // the migration's description names the legacy field it reads
      'features/habits/domain/habitRow.ts',
    ]);
    expect(files.filter((file) => /target_per_week/.test(code(file)))).toEqual([
      'features/habits/domain/habitRow.ts',
      'store/useHabitsStore.ts',
    ]);
  });

  it('keeps entry storage and display out of colour alone: the cell draws a glyph and a spoken label', () => {
    const text = code('components/HabitDayCell.tsx');
    expect(text).toContain('accessibilityLabel');
    expect(text).toContain('STATUS_GLYPH');
    expect(text).toContain("accessibilityRole=\"checkbox\"");
    expect(text).toContain('minHeight: MIN_TARGET');
    expect(code('components/habitGrid.ts')).toMatch(/MIN_TARGET = 44;/);
  });
});

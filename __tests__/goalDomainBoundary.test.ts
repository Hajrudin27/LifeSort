/// <reference types="node" />
import fs from 'fs';
import path from 'path';

/**
 * APP-063 dependency direction (ADR-0003, docs/core-contract.md): a module may depend on core;
 * core may never depend on a module. Rule R6 matches stores, domain utils, routes and components
 * but not `@/features/*`, so this file enforces the missing half for the whole platform, plus the
 * Goals-specific shape of the split:
 *
 *   core/goals/persistedGoal.ts      the persisted FORMAT only (the documented C2 exception)
 *   features/goals/domain/*          the live rules; imports core, never the reverse
 */
const ROOT = path.resolve(__dirname, '..');
const importsOf = (file: string) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
const listFiles = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  : [];
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const source = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The platform surface today (docs/core-contract.md, and CORE_TRACK_DIRS in architectureBoundaries). */
const PLATFORM_DIRS = ['core', 'lib', 'constants', 'hooks', 'utils/shared', 'utils/auth'];
/**
 * Known edges from platform code into a feature. May only shrink. `features/localStores.ts` is the
 * logout registry (a platform service, not a domain). Never add a line to make a test pass.
 */
const FEATURE_IMPORT_BASELINE = ['core/auth/deleteAccount.ts -> @/features/localStores'];

const platformFiles = () => PLATFORM_DIRS.flatMap((dir) => listFiles(path.join(ROOT, dir)))
  .filter((file) => /\.(ts|tsx)$/.test(file));

describe('platform code never depends on a feature (the half of R6 that matches nothing under features/)', () => {
  const edges = platformFiles().flatMap((file) => importsOf(file)
    .filter((specifier) => specifier.startsWith('@/features/'))
    .map((specifier) => `${rel(file)} -> ${specifier}`)).sort();

  it('adds no new edge from core, lib, constants, hooks or utils/shared|auth into a feature', () => {
    expect(edges.filter((edge) => !FEATURE_IMPORT_BASELINE.includes(edge))).toEqual([]);
  });

  it('keeps the baseline honest: a fixed edge must be removed from it', () => {
    expect(FEATURE_IMPORT_BASELINE.filter((edge) => !edges.includes(edge))).toEqual([]);
  });

  it('finds the platform files it is meant to check', () => expect(platformFiles().length).toBeGreaterThan(40));
});

describe('APP-063 Goal persisted-format contract (core/goals)', () => {
  const FILE = 'core/goals/persistedGoal.ts';

  it('depends only on shared entity types and the calendar primitive', () => {
    expect(importsOf(path.join(ROOT, FILE)).sort()).toEqual(['@/types/life', '@/utils/shared/localDate']);
  });

  it('carries the format and the frozen legacy mapping, not the Goals module\'s live rules', () => {
    const text = source(FILE);
    for (const live of ['goalProgress', 'goalIsCompleted', 'meanGoalProgress', 'buildGoal', 'updateGoalFields',
      'withCurrent', 'withCompleted', 'parseAmountInput', 'decodeRemoteGoalRow', 'goalToRow', 'GoalError']) {
      expect(text).not.toContain(live);
    }
    expect(text).toContain('decodeLegacyGoal');
    expect(text).toContain('decodeGoal');
  });

  it('is imported by exactly the migration, the backup parser and the Goals domain', () => {
    const importers = [...platformFiles(), ...['features', 'store', 'app', 'utils'].flatMap((dir) => listFiles(path.join(ROOT, dir)))]
      .filter((file) => /\.(ts|tsx)$/.test(file) && importsOf(file).some((specifier) => specifier.startsWith('@/core/goals')))
      .map(rel);
    expect([...new Set(importers)].sort()).toEqual([
      'core/storage/migrations/goals.ts', 'features/goals/domain/goal.ts', 'utils/shared/backupValidation.ts',
    ]);
  });
});

describe('APP-063 Goal domain (features/goals/domain)', () => {
  const DIR = path.join(ROOT, 'features/goals/domain');
  const files = listFiles(DIR).filter((file) => file.endsWith('.ts'));
  /** Inward and shared only: the core contract, entity types, the calendar primitive, itself. */
  const ALLOWED = [/^\.\/goal$/, /^\.\/goalInput$/, /^@\/core\/goals\/persistedGoal$/, /^@\/types\/life$/, /^@\/utils\/shared\/localDate$/];

  it('finds the domain files', () => expect(files.map((file) => path.basename(file)).sort()).toEqual(['goal.ts', 'goalInput.ts']));

  it('is a pure leaf: no store, UI, routes, sync, money, i18n or network', () => {
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        expect({ file: path.basename(file), specifier, allowed: ALLOWED.some((rule) => rule.test(specifier)) })
          .toEqual({ file: path.basename(file), specifier, allowed: true });
      }
    }
  });

  it('introduces no money primitive and no clock-dependent calendar parsing', () => {
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text).not.toMatch(/import[^;]*MinorUnits/);
      expect(text).not.toMatch(/core\/money/);
      expect(text).not.toMatch(/new Date\(\s*['"`]?\d{4}-/);
      expect(text).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    }
  });

  it('builds canonical integers from digit strings: no float parsing, rounding or scaling in the input parsers', () => {
    // Rounding a float product gives the same integer inside the 10^12 bound, so no behavioural test can
    // tell the two constructions apart. The approved semantic ("no persisted JS floating-point-derived
    // value") is therefore held at the source level.
    const text = fs.readFileSync(path.join(DIR, 'goalInput.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(text).not.toMatch(/parseFloat|Math\.round|toFixed|\*\s*100\b|\/\s*100\b/);
    expect(text).not.toMatch(/Number\(\s*(?:text|value|match\[)/);
  });

  it('is never imported by another feature or store, only by the Goals module and its routes', () => {
    const offenders: string[] = [];
    for (const dir of ['store', 'features']) {
      for (const file of listFiles(path.join(ROOT, dir))) {
        if (!/\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}goals${path.sep}`) || file.endsWith('useLifeGoalsStore.ts')) continue;
        if (importsOf(file).some((specifier) => specifier.startsWith('@/features/goals'))) offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

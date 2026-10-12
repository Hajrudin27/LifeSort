/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { getModule } from '@/core/modules/moduleRegistry';

/**
 * APP-067 dependency direction and scope (ADR-0003, ADR-0055, docs/core-contract.md).
 *
 *   core/career/persistedApplication.ts   the persisted FORMAT only (the documented C2 exception), clock-free
 *   features/career/domain/*              the live rules; imports core, never the reverse
 *   store / screens / form                the APP-067 runtime: local-only, no AI, no inference
 *
 * These are closed, APP-067-scoped guards. They do not ban a future, separately reviewed Profile-B
 * Career sync from existing; they ban it from appearing here without that review.
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

/** Every file that runs the application tracker. */
const RUNTIME = [
  'store/useCareerStore.ts',
  'components/ApplicationForm.tsx',
  'app/career/applications/index.tsx',
  'app/career/applications/new.tsx',
  'app/career/applications/[id].tsx',
  ...listFiles(path.join(ROOT, 'features/career')).map(rel),
  ...listFiles(path.join(ROOT, 'core/career')).map(rel),
];

describe('APP-067 persisted-format contract (core/career)', () => {
  const FILE = 'core/career/persistedApplication.ts';

  it('is the only file in core/career, and depends only on the entity types and the calendar primitive', () => {
    expect(listFiles(path.join(ROOT, 'core/career')).map(rel)).toEqual([FILE]);
    expect(importsOf(path.join(ROOT, FILE)).sort()).toEqual(['@/types/career', '@/utils/shared/localDate']);
  });

  it('never reads the clock: a decoder that answered "is this in the future?" would give different answers on different days', () => {
    expect(code(FILE)).not.toMatch(/Date\.now\(|new Date\(|todayIso|toLocalIsoDate|getTimezoneOffset/);
  });

  it('carries the format, not the Career module\'s live rules', () => {
    const text = code(FILE);
    for (const live of ['validateApplicationInput', 'createApplication', 'applyApplicationEdit', 'sortApplications', 'openableLink', 'openApplicationCount', 'newEntityId']) {
      expect(text).not.toContain(live);
    }
  });

  it('is imported by exactly the Career domain, the store and the backup parser', () => {
    const importers = sourceFiles('core', 'features', 'store', 'app', 'utils', 'components', 'hooks', 'lib')
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('@/core/career')))
      .map(rel);
    expect([...new Set(importers)].sort()).toEqual([
      'features/career/domain/application.ts',
      'store/useCareerStore.ts',
      'utils/shared/backupValidation.ts',
    ]);
  });
});

describe('APP-067 Career domain (features/career/domain)', () => {
  const DIR = path.join(ROOT, 'features/career/domain');
  const files = listFiles(DIR).filter((file) => file.endsWith('.ts'));
  const ALLOWED = [/^@\/core\/career\/persistedApplication$/, /^@\/types\/career$/, /^@\/utils\/shared\/localDate$/];

  it('finds the domain file', () => {
    expect(files.map((file) => path.basename(file))).toEqual(['application.ts']);
    expect(listFiles(path.join(ROOT, 'features/career')).map(rel)).toEqual(['features/career/domain/application.ts']);
  });

  it('is a pure leaf: no store, UI, routes, sync, network, storage or i18n', () => {
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        expect({ specifier, allowed: ALLOWED.some((rule) => rule.test(specifier)) }).toEqual({ specifier, allowed: true });
      }
    }
  });

  it('has no hidden clock or id source: "today", the id and the creation instant are parameters', () => {
    for (const file of files) {
      expect(stripComments(fs.readFileSync(file, 'utf8'))).not.toMatch(/Date\.now\(|new Date\(|todayIso|toLocalIsoDate|randomUUID|newEntityId|Math\.random/);
    }
  });

  it('is imported only by the store, the form, the three screens and the Life tab', () => {
    const importers = sourceFiles('core', 'features', 'store', 'app', 'utils', 'components', 'hooks', 'lib')
      .filter((file) => !file.includes(`${path.sep}features${path.sep}career${path.sep}`))
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('@/features/career')))
      .map(rel).sort();
    expect(importers).toEqual([
      'app/(tabs)/life.tsx',
      'app/career/applications/[id].tsx',
      'app/career/applications/index.tsx',
      'components/ApplicationForm.tsx',
      'store/useCareerStore.ts',
    ].sort());
  });
});

describe('APP-067 runtime is local-only (ADR-0055)', () => {
  it('lists the files this guard covers', () => {
    expect(RUNTIME.sort()).toEqual([
      'app/career/applications/[id].tsx',
      'app/career/applications/index.tsx',
      'app/career/applications/new.tsx',
      'components/ApplicationForm.tsx',
      'core/career/persistedApplication.ts',
      'features/career/domain/application.ts',
      'store/useCareerStore.ts',
    ]);
  });

  it('imports no Supabase client, no sync platform, no outbox and calls no table, RPC, fetch or channel', () => {
    for (const file of RUNTIME) {
      const text = code(file);
      for (const specifier of importsOf(path.join(ROOT, file))) {
        expect({ file, specifier, banned: /^@\/lib\/supabase$|^@supabase\/|^@\/core\/sync|outbox|syncStatus|useSyncStatusStore|syncQueue|serverMutations/i.test(specifier) })
          .toEqual({ file, specifier, banned: false });
      }
      expect({ file, hit: /\.from\(|\.upsert\(|\.rpc\(|\.insert\(|\.channel\(|\bfetch\(|XMLHttpRequest|WebSocket|job_applications|fetchFromSupabase|enqueue|reportSyncFailure/.test(text) }).toEqual({ file, hit: false });
    }
  });

  it('the store persists only through the Profile-B adapter, never plain AsyncStorage', () => {
    for (const file of ['store/useCareerStore.ts', 'store/useCVStore.ts']) {
      const text = code(file);
      expect(text).toContain('migrationGatedStorage(documentMetadataEncryptedStorage)');
      expect(text).not.toMatch(/migrationGatedStorage\(AsyncStorage\)|createJSONStorage\(\(\) => AsyncStorage\)/);
    }
  });

  it('the root layout starts no Career fetch', () => {
    const layout = code('app/_layout.tsx');
    expect(layout).not.toMatch(/useCareerStore|fetchCareer/);
  });

  it('exposes no cloud action on the store', () => {
    expect(code('store/useCareerStore.ts')).not.toMatch(/fetchFrom|syncUpsert|syncDelete|getUserId/);
  });
});

describe('APP-067 holds no AI, no inference and no integrations (APP-068 owns AI)', () => {
  const BANNED_IMPORTS = [
    /openai|anthropic|@ai-sdk|langchain|llm|gemini|mistral|embedding/i,
    /^expo-calendar$/, /^expo-notifications$/, /^expo-contacts$/, /^expo-mail/, /^expo-document-picker$/, /^expo-file-system/, /^expo-image-picker$/, /^expo-sharing$/, /^expo-print$/,
    /useDocumentsStore/, /core\/documents/, /utils\/shared\/attachment/, /documentCacheStorage$/,
    /analytics|sentry|amplitude|posthog|mixpanel/i,
    /useTodoStore|useHabitsStore|useHouseholdStore|useExpensesStore/, /useHomeLayoutStore/,
  ];

  it('imports none of: an AI or LLM provider, calendar, notifications, contacts, email, documents, analytics, other modules\' stores', () => {
    for (const file of RUNTIME.filter((f) => f !== 'store/useCareerStore.ts')) {
      for (const specifier of importsOf(path.join(ROOT, file))) {
        expect({ file, specifier, banned: BANNED_IMPORTS.some((rule) => rule.test(specifier)) }).toEqual({ file, specifier, banned: false });
      }
    }
    // The store alone may name the encrypted adapter, which is the whole point of it.
    for (const specifier of importsOf(path.join(ROOT, 'store/useCareerStore.ts'))) {
      expect({ specifier, banned: BANNED_IMPORTS.filter((rule) => !/documentCacheStorage/.test(rule.source)).some((rule) => rule.test(specifier)) }).toEqual({ specifier, banned: false });
    }
  });

  it('contains no scoring, probability, ranking, recommendation, salary, recruiter or sentiment logic, and no prompt', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /probab|likelihood|likely|fit.?score|\bscore|\brank(?!ing\b)|ranking|predict|recommend|sentiment|salary|recruiter|culture|prompt|completion|summar(?:y|ise|ize)|inferred?|\bbest\b/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('stores no document bytes, filenames or signed URLs', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /documentId|signedUrl|storagePath|originalName|createSignedUrl|attachments?\b|FileSystem|uploadDocument/.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('logs nothing: no console call anywhere in the runtime', () => {
    for (const file of RUNTIME) expect({ file, hit: /\bconsole\./.test(code(file)) }).toEqual({ file, hit: false });
  });

  it('adds no status beyond the existing four', () => {
    for (const file of [...RUNTIME, 'types/career.ts']) {
      expect({ file, hit: /withdrawn|accepted|statusChangedAt|statusHistory|archiv/i.test(code(file)) }).toEqual({ file, hit: false });
    }
    expect(code('types/career.ts')).toContain('export type ApplicationStatus = "applied" | "interview" | "offer" | "rejected";');
  });

  it('adds no field beyond the existing persisted shape', () => {
    const type = code('types/career.ts').match(/export interface JobApplication \{([\s\S]*?)\}/)![1];
    expect(type.split(';').map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean)).toEqual([
      'id: string', 'company: string', 'position: string', 'status: ApplicationStatus', 'appliedDate: string', 'link?: string', 'notes?: string', 'createdAt: string',
    ]);
  });
});

describe('APP-067 adds no Home, Search, reminder or analytics surface', () => {
  it('the Career module registers no Home snapshot, Search entries or notification category', () => {
    const career = getModule('career') as unknown as Record<string, unknown>;
    expect(Object.keys(career).filter((key) => ['homeSnapshot', 'searchEntries', 'notificationCategory'].includes(key))).toEqual([]);
    expect(career.availability).toBe('available');
  });

  it('Home snapshots and the Home tab never mention Career', () => {
    for (const file of ['features/homeSnapshots.ts', 'app/(tabs)/index.tsx']) {
      expect({ file, hit: /career/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('the Life tab keeps its existing Career card and uses neutral wording only', () => {
    const en = fs.readFileSync(path.join(ROOT, 'localization/locales/en/life.json'), 'utf8');
    const da = fs.readFileSync(path.join(ROOT, 'localization/locales/da/life.json'), 'utf8');
    expect(en).toContain('"careerMetricLabel": "Open applications"');
    expect(da).toContain('"careerMetricLabel": "Åbne ansøgninger"');
    for (const text of [en, da]) expect(text).not.toMatch(/opportunit|muligheder/i);
    expect(code('app/(tabs)/life.tsx')).toContain("key: 'career'");
  });
});

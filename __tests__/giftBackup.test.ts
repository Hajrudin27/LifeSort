import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import path from 'path';

import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

/**
 * APP-069 backup format 14: Gifts are local-only, so a backup file is the ONLY way to move them to a
 * new phone. They travel through the injected participant seam (features/backupParticipants.ts), so
 * core gains no import of the Gifts store, and every older format restores exactly as before.
 */
let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false, size: 0 })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-file-system', () => ({ File: class { bytes() { return Promise.reject(new Error('missing')); } } }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) }, from: jest.fn(), rpc: jest.fn() },
}));

import { BACKUP_PARTICIPANTS } from '@/features/backupParticipants';
import { useCareerStore } from '@/store/useCareerStore';
import { useCVStore } from '@/store/useCVStore';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useGiftsStore } from '@/store/useGiftsStore';
import { useTodoStore } from '@/store/useTodoStore';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PERSON = 'Backup Sentinel Person';
const giftRow = (patch: Record<string, unknown> = {}) => ({
  id: 'g-1', personLabel: PERSON, idea: 'A backup sentinel idea', occasionLabel: 'Birthday', occasionDate: '2026-12-24', budget: 30_000,
  purchasedOn: '2026-10-01', paid: 27_950, createdAt: '2026-10-12T09:30:00.000Z', ...patch,
});
const file = (version: number, data: Record<string, unknown>) =>
  JSON.stringify({ version, exportedAt: '2026-10-12T00:00:00.000Z', data });
const gifts = (version: number, rows: unknown[]) => file(version, { gifts: { gifts: rows } });
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const current = () => useGiftsStore.getState().gifts;
const resetStores = () => {
  useGiftsStore.setState({ gifts: [] });
  useCareerStore.setState({ applications: [], skills: [] });
  useCVStore.setState({ personalInfo: {} as never, education: [], experience: [], languages: [], versions: [] });
  useTodoStore.setState({ todos: [] });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
};
const importFile = async (content: string, participants = BACKUP_PARTICIPANTS) => {
  mockFileContent = content;
  return importBackup(participants);
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockWritten = '';
  mockFileContent = '';
  await AsyncStorage.clear();
  await Promise.all([useGiftsStore.persist.rehydrate(), useCareerStore.persist.rehydrate(), useCVStore.persist.rehydrate()]);
  resetStores();
});

describe('format', () => {
  it('is 14, and a newer file is refused whole, even with valid gifts', () => {
    expect(BACKUP_VERSION).toBe(14);
    for (const version of [15, 16, 99]) {
      expect(parseBackupFile(gifts(version, [giftRow()]))).toEqual({ ok: false, error: 'unsupported_version' });
    }
  });

  it('is what makes an older reader refuse a Gifts file rather than silently ignore it', () => {
    // An app that reads up to 13 sees version 14 > 13: unsupported_version, never a partial restore.
    const olderReaderLimit = 13;
    expect(BACKUP_VERSION).toBeGreaterThan(olderReaderLimit);
  });
});

describe('a new export', () => {
  it('carries gifts as exactly { gifts: [...] }, each gift with exactly its own keys in canonical order', async () => {
    useGiftsStore.setState({ gifts: [giftRow() as never, giftRow({ id: 'g-2', occasionLabel: undefined, occasionDate: undefined, budget: undefined, purchasedOn: undefined, paid: undefined }) as never] });
    await exportBackup(BACKUP_PARTICIPANTS);
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(14);
    expect(Object.keys(exported.data.gifts)).toEqual(['gifts']);
    expect(exported.data.gifts.gifts).toHaveLength(2);
    expect(Object.keys(exported.data.gifts.gifts[0])).toEqual(['id', 'personLabel', 'idea', 'occasionLabel', 'occasionDate', 'budget', 'purchasedOn', 'paid', 'createdAt']);
    expect(Object.keys(exported.data.gifts.gifts[1])).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
    expect(exported.data.gifts.gifts[0]).toEqual(giftRow());
  });

  it('exports an empty list as { gifts: [] }, so a restore of it is an explicit "no gifts"', async () => {
    await exportBackup(BACKUP_PARTICIPANTS);
    expect(JSON.parse(mockWritten).data.gifts).toEqual({ gifts: [] });
  });

  it('is accepted by its own parser, and every gift in it decodes to what was exported', async () => {
    useGiftsStore.getState().addGift({ personLabel: PERSON, idea: 'Round trip', budget: '99,95', purchased: true, purchasedOn: '2026-10-01', paid: '89', occasionLabel: 'Anniversary', occasionDate: '2027-03-01' });
    await exportBackup(BACKUP_PARTICIPANTS);
    const parsed = parseBackupFile(mockWritten);
    expect(parsed).toMatchObject({ ok: true, version: 14 });
    expect(parsed.ok && parsed.data.gifts).toEqual({ gifts: current() });
  });

  it('writes nothing about gifts when no participant is passed: the pre-existing backup is untouched', async () => {
    useGiftsStore.setState({ gifts: [giftRow() as never] });
    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect('gifts' in exported.data).toBe(false);
    expect(mockWritten).not.toContain(PERSON);
  });
});

describe('restoring a format 14 file', () => {
  it('round-trips: export, wipe, import gives the same gifts back, and reports the key', async () => {
    useGiftsStore.getState().addGift({ personLabel: PERSON, idea: 'One', budget: '10', purchased: false });
    useGiftsStore.getState().addGift({ personLabel: PERSON, idea: 'Two', purchased: true, purchasedOn: '2026-10-01', paid: '0' });
    const before = current();
    await exportBackup(BACKUP_PARTICIPANTS);

    useGiftsStore.setState({ gifts: [] });
    const result = await importFile(mockWritten);

    expect(result).toMatchObject({ success: true });
    expect(result!.restoredKeys).toContain('gifts');
    expect(current()).toEqual(before);
  });

  it('replaces what is on the device, like every other domain, and restores an explicit empty list as empty', async () => {
    useGiftsStore.setState({ gifts: [giftRow({ id: 'old' }) as never] });
    await importFile(gifts(14, [giftRow({ id: 'new' })]));
    expect(current().map((g) => g.id)).toEqual(['new']);
    await importFile(gifts(14, []));
    expect(current()).toEqual([]);
  });

  it('survives an app restart after a restore: the restored gifts are on disk and come back', async () => {
    await importFile(gifts(14, [giftRow({ id: 'a' }), giftRow({ id: 'b', purchasedOn: undefined, paid: undefined })]));
    await settle();
    const restored = current();
    expect(restored).toHaveLength(2);
    useGiftsStore.setState({ gifts: [] });
    await useGiftsStore.persist.rehydrate();
    expect(current()).toEqual(restored);
  });

  it('keeps a future purchase date: the clock is never consulted when restoring', async () => {
    await importFile(gifts(14, [giftRow({ purchasedOn: '2999-01-01' })]));
    expect(current()[0].purchasedOn).toBe('2999-01-01');
  });

  it('allows the same person and the same occasion on several gifts', async () => {
    await importFile(gifts(14, [giftRow({ id: 'a' }), giftRow({ id: 'b' })]));
    expect(current()).toHaveLength(2);
  });
});

describe('a bad Gifts payload refuses the whole file (nothing is half-restored)', () => {
  const restoring = (extra: Record<string, unknown> = {}) => (rows: unknown[]) => file(14, { todos: { todos: [{ id: 't', title: 'Restored todo' }] }, ...extra, gifts: { gifts: rows } });

  it.each([
    ['an unknown key', [giftRow(), giftRow({ id: 'g-2', surprise: 1 })]],
    ['a repeated id', [giftRow(), giftRow({ idea: 'again' })]],
    ['a negative budget', [giftRow({ budget: -1 })]],
    ['a fractional paid amount', [giftRow({ paid: 1.5 })]],
    ['a string amount', [giftRow({ budget: '300' })]],
    ['an impossible occasion date', [giftRow({ occasionDate: '2026-02-30' })]],
    ['an impossible purchase date', [giftRow({ purchasedOn: '2026-13-01' })]],
    ['a paid amount without a purchase date', [giftRow({ purchasedOn: undefined })]],
    ['an untrimmed person', [giftRow({ personLabel: ' Anna' })]],
    ['a newline in the idea', [giftRow({ idea: 'a\nb' })]],
    ['a person above 100 units', [giftRow({ personLabel: 'x'.repeat(101) })]],
    ['a null optional', [giftRow({ occasionLabel: null })]],
    ['a createdAt that is not an instant', [giftRow({ createdAt: 'yesterday' })]],
    ['a row that is not an object', [giftRow(), 'junk']],
  ])('%s', async (_name, rows) => {
    useGiftsStore.setState({ gifts: [giftRow({ id: 'local' }) as never] });
    const result = await importFile(restoring()(rows as unknown[]));
    expect(result).toEqual({ success: false, restoredKeys: [], skippedKeys: [], error: 'invalid_format' });
    // Neither the gifts nor anything else in the same file was written.
    expect(current().map((g) => g.id)).toEqual(['local']);
    expect(useTodoStore.getState().todos).toEqual([]);
  });

  it.each([
    ['a container with an extra key', { gifts: [giftRow()], extra: 1 }],
    ['a container without the list', {}],
    ['a list that is not an array', { gifts: { 0: giftRow() } }],
    ['a null container', null],
    ['a container that is a list', [giftRow()]],
  ])('%s', (_name, container) => {
    expect(parseBackupFile(file(14, { gifts: container }))).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('formats 1-13 never carry gifts, and otherwise restore exactly as before', () => {
  it.each([1, 7, 12, 13])('format %i with a gifts key is not a file this app wrote: refused', (version) => {
    expect(parseBackupFile(gifts(version, [giftRow()]))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(gifts(version, []))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(file(version, { gifts: {} }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('refuses such a file whole, leaving every store untouched', async () => {
    const result = await importFile(file(13, { todos: { todos: [{ id: 't', title: 'x' }] }, gifts: { gifts: [giftRow()] } }));
    expect(result).toMatchObject({ success: false, error: 'invalid_format' });
    expect(useTodoStore.getState().todos).toEqual([]);
    expect(current()).toEqual([]);
  });

  it('restores a format 13 file with no gifts exactly as before, and leaves the gifts on the device alone', async () => {
    useGiftsStore.setState({ gifts: [giftRow({ id: 'keep' }) as never] });
    const result = await importFile(file(13, { todos: { todos: [{ id: 't', title: 'Old todo', completed: false, createdAt: '2026-09-01T00:00:00.000Z' }] } }));
    expect(result).toMatchObject({ success: true, restoredKeys: ['todos'] });
    expect(result!.skippedKeys).toContain('gifts');
    expect(current().map((g) => g.id)).toEqual(['keep']);
    expect(useTodoStore.getState().todos).toHaveLength(1);
  });

  it.each([1, 5, 12])('format %i parses to the same data as before, with no gifts entry', (version) => {
    const parsed = parseBackupFile(file(version, { todos: { todos: [] }, settings: { language: 'da' } }));
    expect(parsed).toMatchObject({ ok: true, version, data: { todos: { todos: [] }, settings: { language: 'da' } } });
    expect(parsed.ok && 'gifts' in parsed.data).toBe(false);
  });

  it('keeps the format 13 Career rule: a file of 13 or newer carrying applications or a CV is still refused', () => {
    expect(parseBackupFile(file(14, { career: { applications: [], skills: [] } }))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(file(14, { cv: { personalInfo: {} } }))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(file(14, { career: { skills: [] } }))).toMatchObject({ ok: true });
  });
});

describe('restoring gifts leaves Career and the CV alone', () => {
  it('a file carrying gifts and career skills restores both, and the gifts never alter Career or CV state', async () => {
    useCareerStore.setState({ applications: [{ id: 'app', company: 'Keep Co', position: 'Role', status: 'applied', appliedDate: '2026-09-01', createdAt: '2026-09-01T08:00:00.000Z' }], skills: [] });
    useCVStore.setState({ personalInfo: { fullName: 'Keep Person', phone: '+45 11 22 33 44' } as never });
    const result = await importFile(file(14, { career: { skills: [{ id: 's', name: 'Excel', category: 'technical', level: 'expert', createdAt: '2026-09-01T00:00:00.000Z' }] }, gifts: { gifts: [giftRow()] } }));
    expect(result).toMatchObject({ success: true });
    expect(useCareerStore.getState().skills.map((s) => s.name)).toEqual(['Excel']);
    // Applications and the CV are Profile B and are neither written to nor cleared by a restore.
    expect(useCareerStore.getState().applications.map((a) => a.id)).toEqual(['app']);
    expect(useCVStore.getState().personalInfo).toMatchObject({ fullName: 'Keep Person' });
    expect(current()).toHaveLength(1);
  });

  it('a new export still carries career skills only, no applications and no CV, next to the gifts', async () => {
    useCareerStore.getState().addApplication({ company: 'Secret Co', position: 'Role', status: 'applied', appliedDate: '2026-09-01', notes: 'secret note' });
    useCareerStore.getState().addSkill({ name: 'Excel', category: 'technical', level: 'expert' });
    useCVStore.setState({ personalInfo: { fullName: 'Secret Person', phone: '+45 55 66 77 88' } as never });
    useGiftsStore.setState({ gifts: [giftRow() as never] });
    await exportBackup(BACKUP_PARTICIPANTS);
    const exported = JSON.parse(mockWritten);
    expect(Object.keys(exported.data.career)).toEqual(['skills']);
    expect('cv' in exported.data).toBe(false);
    for (const secret of ['Secret Co', 'secret note', 'Secret Person', '+45 55 66 77 88']) expect(mockWritten).not.toContain(secret);
    expect(exported.data.gifts.gifts).toHaveLength(1);
  });
});

describe('the participant seam adds no core -> domain edge (R6)', () => {
  const importsOf = (file: string) => [...read(file).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

  it('utils/shared/dataBackup.ts imports exactly the stores it imported before, and no Gifts code', () => {
    const stores = importsOf('utils/shared/dataBackup.ts').filter((s) => /^@\/store\//.test(s)).sort();
    expect(stores).toEqual([
      '@/store/useCVStore', '@/store/useCareerStore', '@/store/useCategoriesStore', '@/store/useExpensesStore', '@/store/useFoodStore',
      '@/store/useHabitsStore', '@/store/useHouseholdStore', '@/store/useIncomeStore', '@/store/useLifeGoalsStore', '@/store/useSavingsGoalsStore',
      '@/store/useSettingsStore', '@/store/useSkillCategoriesStore', '@/store/useTodoStore', '@/store/useTripsStore', '@/store/useWarrantiesStore',
    ].sort());
    expect(stores).toHaveLength(15);
    const text = read('utils/shared/dataBackup.ts');
    expect(text).not.toMatch(/useGiftsStore|store\/useGifts|@\/features\/|@\/core\/gifts/);
  });

  it('core reaches the Gifts format only through core/gifts/persistedGift, never a store or a feature', () => {
    expect(importsOf('utils/shared/backupValidation.ts').filter((s) => /gift/i.test(s))).toEqual(['@/core/gifts/persistedGift']);
    expect(importsOf('core/gifts/persistedGift.ts').sort()).toEqual([
      '@/core/money/minorUnits', '@/core/money/supportedMoney', '@/types/gift', '@/utils/shared/localDate',
    ].sort());
  });

  it('the composition file is the only place that names both the store and the seam', () => {
    expect(importsOf('features/backupParticipants.ts').sort()).toEqual(['@/store/useGiftsStore', '@/utils/shared/dataBackup']);
    expect(read('features/backupParticipants.ts')).toMatch(/key: 'gifts'/);
  });

  it('domain code never imports the backup core, and the participant key cannot shadow a built-in store', () => {
    for (const file of ['store/useGiftsStore.ts', 'features/gifts/domain/gift.ts', 'core/gifts/persistedGift.ts', 'components/GiftForm.tsx']) {
      expect({ file, hit: importsOf(file).some((s) => /dataBackup|backupValidation|backupParticipants/.test(s)) }).toEqual({ file, hit: false });
    }
    expect(read('utils/shared/dataBackup.ts')).toContain('Exclude<BackupStoreKey, StoreKey>');
  });

  /**
   * The participant list is an optional argument, so the invariant "every runtime export and restore
   * carries the Gifts" cannot be a compile error without rewriting 46 existing calls. It is therefore a
   * test, and the test reads the SYNTAX TREE rather than text: a text search for a call is blind to an
   * aliased import, a namespace import, a re-export, a `require` and any folder it does not walk, and
   * each of those would drop the Gifts without a single failing test.
   *
   * What it proves instead: no runtime file anywhere in the repository except the backup screen can
   * reach `exportBackup` / `importBackup` by ANY import form, and the screen's only uses of them are
   * two direct calls that pass `BACKUP_PARTICIPANTS`.
   */
  describe('the participant list cannot be dropped by a runtime caller (syntax-tree guard)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = require('typescript') as typeof import('typescript');
    const BACKUP_MODULE = 'utils/shared/dataBackup';
    const SCREEN = 'app/settings/backup.tsx';
    const PARTICIPANTS_MODULE = 'features/backupParticipants';
    const FUNCTIONS = ['exportBackup', 'importBackup'];
    // Tests call the core directly on purpose (they exercise formats 1-13 without participants).
    const SKIPPED_DIRECTORIES = new Set(['node_modules', '__tests__', 'tests', 'docs', 'assets', 'dist', 'ios', 'android', 'web-build']);

    const runtimeFiles = (): string[] => {
      const found: string[] = [];
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name.startsWith('brag-output') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
          const relative = directory === '.' ? entry.name : `${directory}/${entry.name}`;
          if (entry.isDirectory()) walk(relative);
          else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(entry.name)) found.push(relative);
        }
      };
      walk('.');
      return found;
    };

    /** Repo-relative path of a module specifier, without extension, or null for a package. */
    const resolveSpecifier = (specifier: string, from: string): string | null => {
      const base = specifier.startsWith('@/')
        ? specifier.slice(2)
        : specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)) : null;
      return base === null ? null : base.replace(/\.(tsx?|jsx?|cjs|mjs)$/, '').replace(/\/index$/, '');
    };

    const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const isStringLiteral = (node: import('typescript').Node | undefined): node is import('typescript').StringLiteral =>
      node !== undefined && ts.isStringLiteral(node);

    /** Every way a file can name the backup module at runtime. Type-only imports are erased and ignored. */
    const runtimeReferencesTo = (moduleName: string, file: string, source: import('typescript').SourceFile): import('typescript').Node[] => {
      const references: import('typescript').Node[] = [];
      const visit = (node: import('typescript').Node) => {
        if (ts.isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier) && resolveSpecifier(node.moduleSpecifier.text, file) === moduleName) {
          const clause = node.importClause;
          const bindings = clause?.namedBindings;
          const typeOnly = clause !== undefined && (clause.isTypeOnly
            || (clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings)
              && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)));
          if (!typeOnly) references.push(node);
        } else if (ts.isExportDeclaration(node) && isStringLiteral(node.moduleSpecifier) && resolveSpecifier(node.moduleSpecifier.text, file) === moduleName) {
          if (!node.isTypeOnly) references.push(node);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
          && isStringLiteral(node.moduleReference.expression) && resolveSpecifier(node.moduleReference.expression.text, file) === moduleName) {
          references.push(node);
        } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && isStringLiteral(node.arguments[0])
          && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          && resolveSpecifier((node.arguments[0] as import('typescript').StringLiteral).text, file) === moduleName) {
          references.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return references;
    };

    it('finds the files it is meant to check, and parses the screen', () => {
      const files = runtimeFiles();
      expect(files.length).toBeGreaterThan(200);
      expect(files).toEqual(expect.arrayContaining([SCREEN, 'utils/shared/dataBackup.ts', 'features/backupParticipants.ts', 'scripts/check-adr.js']));
      expect(files.some((file) => file.startsWith('__tests__/'))).toBe(false);
    });

    it('no runtime file but the backup screen imports exportBackup / importBackup, in any import form', () => {
      // Cheap pre-filter on the module's own name: every import form has to spell it.
      const importers = runtimeFiles()
        .filter((file) => file !== 'utils/shared/dataBackup.ts' && read(file).includes('dataBackup'))
        .filter((file) => runtimeReferencesTo(BACKUP_MODULE, file, parse(file)).length > 0);
      expect(importers).toEqual([SCREEN]);
    });

    it('the screen has exactly two uses of them, a direct export call and a direct import call, each passing BACKUP_PARTICIPANTS', () => {
      const source = parse(SCREEN);
      const local = new Map<string, string>(); // local name -> exported name
      const namespaces = new Set<string>();
      let participantsImported = false;
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
        const target = resolveSpecifier(statement.moduleSpecifier.text, SCREEN);
        const bindings = statement.importClause?.namedBindings;
        if (target === BACKUP_MODULE && bindings) {
          if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
          else for (const element of bindings.elements) local.set(element.name.text, (element.propertyName ?? element.name).text);
        }
        if (target === PARTICIPANTS_MODULE && bindings && ts.isNamedImports(bindings)) {
          participantsImported = bindings.elements.some((element) => element.name.text === 'BACKUP_PARTICIPANTS' && element.propertyName === undefined);
        }
      }
      expect(participantsImported).toBe(true);
      expect([...local.values()].sort()).toEqual([...FUNCTIONS].sort());

      const calls: Array<{ name: string; first: string | null; count: number }> = [];
      const strays: string[] = [];
      const visit = (node: import('typescript').Node) => {
        if (ts.isImportDeclaration(node)) return;
        let name: string | undefined;
        let reference: import('typescript').Node | undefined;
        // An identifier that is merely the property NAME of some other object (`store.exportBackup()`) is
        // not a reference to the imported binding.
        const isPropertyName = (candidate: import('typescript').Node) =>
          ts.isPropertyAccessExpression(candidate.parent) && candidate.parent.name === candidate;
        if (ts.isIdentifier(node) && local.has(node.text) && !isPropertyName(node)) { name = local.get(node.text); reference = node; }
        else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) { name = node.name.text; reference = node; }
        if (name !== undefined && reference !== undefined) {
          const parent = reference.parent;
          if (ts.isCallExpression(parent) && parent.expression === reference) {
            const [first] = parent.arguments;
            calls.push({ name, first: first && ts.isIdentifier(first) ? first.text : null, count: parent.arguments.length });
          } else {
            // Passed around, stored, re-exported, `.call`ed or `.bind`ed: not a call the guard can vouch for.
            strays.push(`${name} @ ${source.getLineAndCharacterOfPosition(reference.getStart(source)).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);

      expect(strays).toEqual([]);
      expect(calls.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: 'exportBackup', first: 'BACKUP_PARTICIPANTS', count: 1 },
        { name: 'importBackup', first: 'BACKUP_PARTICIPANTS', count: 1 },
      ]);
    });
  });

  it('the Gifts payload is the one thing a participant exports: an explicit whitelist', () => {
    expect(read('store/useGiftsStore.ts')).toContain('exportBackup: () => ({ gifts: get().gifts })');
  });
});

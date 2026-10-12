/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { getModule } from '@/core/modules/moduleRegistry';

/**
 * APP-069 dependency direction and scope (ADR-0003, ADR-0056, docs/core-contract.md).
 *
 *   core/gifts/persistedGift.ts   the persisted FORMAT only (the documented C2 exception), clock-free
 *   features/gifts/domain/*       the live rules; imports core, never the reverse
 *   store / screens / form        the APP-069 runtime: local-only, no Contacts, no Economy, no AI
 *
 * These are closed, APP-069-scoped guards. They do not ban a future, separately reviewed feature
 * (an Economy allocation bridge, Gift sync) from existing; they ban it from appearing here without
 * that review.
 *
 * APP-070 (ADR-0057) deliberately replaced the original blanket "no Contacts anywhere" rule with a narrow
 * one: exactly one adapter, features/gifts/contacts/pickContactName.ts, may load `expo-contacts/legacy`,
 * to let an iOS user pick ONE contact and copy its name. Every other Gift file stays free of Contacts.
 */
const ROOT = path.resolve(__dirname, '..');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
// Static imports, `require('...')` and dynamic `import('...')` all count: a guard that only read
// `from '...'` would let a store be reached by an inline require.
const importsOf = (file: string) =>
  [...stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8')).matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
const listFiles = (dir: string): string[] => fs.existsSync(path.join(ROOT, dir))
  ? fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`])
  : [];
const code = (file: string) => stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
/** The one file allowed to load expo-contacts (APP-070, ADR-0057). */
const ADAPTER = 'features/gifts/contacts/pickContactName.ts';
const sourceFiles = (...dirs: string[]) => dirs.flatMap(listFiles).filter((file) => /\.(ts|tsx)$/.test(file));

/** Every file that runs the Gift planner. */
const RUNTIME = [
  'store/useGiftsStore.ts',
  'components/GiftForm.tsx',
  'app/gifts/index.tsx',
  'app/gifts/new.tsx',
  'app/gifts/[id].tsx',
  'types/gift.ts',
  ...listFiles('features/gifts'),
  ...listFiles('core/gifts'),
];

describe('APP-069 persisted-format contract (core/gifts)', () => {
  const FILE = 'core/gifts/persistedGift.ts';

  it('is the only file in core/gifts, and depends only on the money primitives, the entity type and the calendar primitive', () => {
    expect(listFiles('core/gifts')).toEqual([FILE]);
    expect(importsOf(FILE).sort()).toEqual(['@/core/money/minorUnits', '@/core/money/supportedMoney', '@/types/gift', '@/utils/shared/localDate']);
  });

  it('never reads the clock: a decoder that answered "is this in the future?" would give different answers on different days', () => {
    expect(code(FILE)).not.toMatch(/Date\.now\(|new Date\(|Date\.parse|todayIso|toLocalIsoDate|getTimezoneOffset/);
  });

  it('carries the format, not the Gifts module\'s live rules', () => {
    const text = code(FILE);
    for (const live of ['validateGiftInput', 'createGift', 'applyGiftEdit', 'sortPlanned', 'sortPurchased', 'partitionGifts', 'markPurchased', 'newEntityId']) {
      expect(text).not.toContain(live);
    }
  });

  it('is imported by exactly the Gifts domain, the store and the backup parser', () => {
    const importers = sourceFiles('core', 'features', 'store', 'app', 'utils', 'components', 'hooks', 'lib')
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('@/core/gifts')))
      .sort();
    expect(importers).toEqual(['features/gifts/domain/gift.ts', 'store/useGiftsStore.ts', 'utils/shared/backupValidation.ts']);
  });
});

describe('APP-069 Gift domain (features/gifts/domain)', () => {
  const FILES = listFiles('features/gifts/domain');
  const ALLOWED = [
    /^@\/core\/gifts\/persistedGift$/, /^@\/core\/money\/minorUnits$/, /^@\/core\/money\/supportedMoney$/, /^@\/types\/gift$/, /^@\/utils\/shared\/localDate$/,
  ];

  it('is exactly one file', () => {
    expect(FILES).toEqual(['features/gifts/domain/gift.ts']);
  });

  it('is a pure leaf: no store, UI, routes, sync, network, storage or i18n', () => {
    for (const file of FILES) {
      for (const specifier of importsOf(file)) {
        expect({ specifier, allowed: ALLOWED.some((rule) => rule.test(specifier)) }).toEqual({ specifier, allowed: true });
      }
    }
  });

  it('has no hidden clock or id source: "today", the id and the creation instant are parameters', () => {
    for (const file of FILES) {
      expect(code(file)).not.toMatch(/Date\.now\(|new Date\(|todayIso|toLocalIsoDate|randomUUID|newEntityId|Math\.random/);
    }
  });

  it('is imported only by the store, the form and the list screen', () => {
    const importers = sourceFiles('core', 'features', 'store', 'app', 'utils', 'components', 'hooks', 'lib')
      .filter((file) => !file.startsWith('features/gifts/'))
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('@/features/gifts')))
      .sort();
    expect(importers).toEqual(['app/gifts/index.tsx', 'components/GiftForm.tsx', 'store/useGiftsStore.ts']);
  });
});

describe('APP-069 is local-only: no Supabase, no outbox, no sync (ADR-0056)', () => {
  it('lists the files this guard covers', () => {
    expect([...RUNTIME].sort()).toEqual([
      'app/gifts/[id].tsx',
      'app/gifts/index.tsx',
      'app/gifts/new.tsx',
      'components/GiftForm.tsx',
      'core/gifts/persistedGift.ts',
      'features/gifts/contacts/pickContactName.ts',
      'features/gifts/domain/gift.ts',
      'store/useGiftsStore.ts',
      'types/gift.ts',
    ]);
  });

  it('imports no Supabase client, no sync platform and no outbox, and calls no table, RPC, fetch or channel', () => {
    for (const file of RUNTIME) {
      const text = code(file);
      for (const specifier of importsOf(file)) {
        expect({ file, specifier, banned: /^@\/lib\/supabase$|^@supabase\/|^@\/core\/sync|outbox|syncStatus|useSyncStatusStore|syncQueue|serverMutations|mutationSupport/i.test(specifier) })
          .toEqual({ file, specifier, banned: false });
      }
      expect({ file, hit: /\.from\(|\.upsert\(|\.rpc\(|\.insert\(|\.channel\(|\bfetch\(|XMLHttpRequest|WebSocket|enqueue|reportSyncFailure|mutationSupport|\bgifts?_?table|getUserId|\bsupabase\b/i.test(text) }).toEqual({ file, hit: false });
    }
  });

  it('has no revision, tombstone, mutation or reconciliation concept', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /revision|tombstone|deleted_?at|updatedAt|mutationId|reconcil|conflictPolic/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('persists through plain, migration-gated AsyncStorage: no custom adapter, no encryption, no cloud mirror', () => {
    const text = code('store/useGiftsStore.ts');
    expect(text).toContain('migrationGatedStorage(AsyncStorage)');
    expect(text).toContain("name: 'lifesort-gifts'");
    expect(text).not.toMatch(/documentMetadataEncryptedStorage|cycleHealthEncryptedStorage|documentCacheStorage|SecureStore|expo-crypto/);
    expect(importsOf('store/useGiftsStore.ts').filter((s) => /^@\/store\//.test(s))).toEqual([]);
  });

  it('adds nothing to the database: no migration, table, policy, grant or function mentions gifts', () => {
    const files = listFiles('supabase');
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => /gift/i.test(file))).toEqual([]);
    expect(files.filter((file) => /gift/i.test(fs.readFileSync(path.join(ROOT, file), 'utf8')))).toEqual([]);
  });
});

describe('APP-069 reaches no other module, and Economy only through core money primitives', () => {
  it('imports no store except its own', () => {
    for (const file of RUNTIME) {
      for (const specifier of importsOf(file).filter((s) => /^@\/store\//.test(s))) {
        expect({ file, specifier }).toEqual({ file, specifier: '@/store/useGiftsStore' });
      }
    }
  });

  it('imports no Economy feature, store, util or core module, and no other domain\'s feature code', () => {
    const BANNED = [
      /^@\/features\/(?!gifts\b)/, /^@\/utils\/(?!shared\/localDate$)/, /^@\/core\/(?!gifts\b|ids$|money\/|storage\/migrations\/runtime$)/,
      /useExpensesStore|useIncomeStore|useSavingsGoalsStore|useCategoriesStore|useFoodStore|useTripsStore|useWarrantiesStore|useTodoStore|useHabitsStore|useCareerStore|useDocumentsStore/,
    ];
    for (const file of RUNTIME) {
      for (const specifier of importsOf(file)) {
        expect({ file, specifier, banned: BANNED.some((rule) => rule.test(specifier)) }).toEqual({ file, specifier, banned: false });
      }
    }
  });

  it('uses only the shared money primitives it needs, and no custom money parser', () => {
    const money = RUNTIME.flatMap((file) => importsOf(file).filter((s) => s.startsWith('@/core/money')).map((s) => `${file} ${s}`)).sort();
    expect(money).toEqual([
      'app/gifts/index.tsx @/core/money/format',
      'app/gifts/index.tsx @/core/money/minorUnits',
      'components/GiftForm.tsx @/core/money/decimal',
      'components/GiftForm.tsx @/core/money/format',
      'core/gifts/persistedGift.ts @/core/money/minorUnits',
      'core/gifts/persistedGift.ts @/core/money/supportedMoney',
      'features/gifts/domain/gift.ts @/core/money/minorUnits',
      'features/gifts/domain/gift.ts @/core/money/supportedMoney',
      'types/gift.ts @/core/money/minorUnits',
    ]);
    // The usual sloppy-money patterns, everywhere. (`Number(` is also banned wherever an amount lives;
    // the form's only `Number(` reads a calendar YEAR for the date picker's window.)
    for (const file of RUNTIME) {
      expect({ file, hit: /parseFloat|parseInt|\*\s*100|\/\s*100|toFixed|Math\.round/.test(code(file)) }).toEqual({ file, hit: false });
    }
    for (const file of ['core/gifts/persistedGift.ts', 'features/gifts/domain/gift.ts', 'store/useGiftsStore.ts', 'app/gifts/index.tsx']) {
      expect({ file, hit: /Number\(/.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('carries no budget link, expense id, savings id or trip id: no placeholder for a bridge that does not exist', () => {
    for (const file of [...RUNTIME, 'core/storage/dataProfileRegistry.ts']) {
      const text = file === 'core/storage/dataProfileRegistry.ts'
        ? code(file).split("id: 'gifts.gifts'")[1].split("id: 'cycle.user-health'")[0]
        : code(file);
      expect({ file, hit: /budgetAllocationId|allocationId|expenseId|savingsGoalId|tripBudgetId|tripId|economyLink/i.test(text) }).toEqual({ file, hit: false });
    }
  });

  it('no Economy code mentions the Gift planner either: nothing is wired in the other direction', () => {
    const economy = sourceFiles('features/economy', 'core/economy', 'utils/expense', 'utils/savings', 'store').filter((file) => /Expenses|Income|Savings|economy|expense|savings/i.test(file));
    expect(economy.length).toBeGreaterThan(3);
    // (The savings icon picker has an icon literally named "gift"; that is a picture, not the planner.)
    for (const file of economy) expect({ file, hit: /useGiftsStore|@\/features\/gifts|@\/core\/gifts|['"`]\/gifts/.test(code(file)) }).toEqual({ file, hit: false });
  });
});

describe('APP-069 holds no calendar, notification, AI, commerce or analytics surface (Contacts: see APP-070 below)', () => {
  const BANNED_IMPORTS = [
    /^expo-contacts/, /^expo-calendar$/, /^expo-notifications$/, /^expo-mail/, /^expo-document-picker$/, /^expo-file-system/, /^expo-image-picker$/, /^expo-image$/,
    /^expo-camera$/, /^expo-sharing$/, /^expo-print$/, /^expo-linking$/, /^expo-web-browser$/, /^expo-location$/, /^expo-barcode/,
    /openai|anthropic|@ai-sdk|langchain|llm|gemini|mistral|embedding/i,
    /analytics|sentry|amplitude|posthog|mixpanel/i,
    /useDocumentsStore|core\/documents|utils\/shared\/attachment|documentCacheStorage$/,
  ];

  it('imports none of: calendar, notifications, files, camera, links, an AI provider, analytics, and Contacts anywhere but the adapter', () => {
    for (const file of RUNTIME) {
      // The adapter's own `expo-contacts/legacy` is the single approved Contacts import.
      for (const specifier of importsOf(file).filter((s) => !(file === ADAPTER && s === 'expo-contacts/legacy'))) {
        expect({ file, specifier, banned: BANNED_IMPORTS.some((rule) => rule.test(specifier)) }).toEqual({ file, specifier, banned: false });
      }
    }
  });

  it('installs only the expo-contacts package for Contacts, and declares nothing else for calendar or notifications beyond what existed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => /contacts/i.test(name))).toEqual(['expo-contacts']);
  });

  it('contains no recommendation, price lookup, product, image, shop, link, scraping or prompt logic', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /recommend|suggest|inspir|trending|popular|affiliate|marketplace|shop(?!ping)|retailer|scrap(?:e|ing)|price(?:s|Lookup)?\b|prompt|completion|summar(?:y|ise|ize)|\bscore\b|\brank(?!ing\b)|Linking|openURL|WebBrowser|<Image\b|\buri:/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('has no reminder, urgency or overdue concept: a past occasion is only a date', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /overdue|due soon|dueSoon|urgen|remind|schedule[dN]|notification|countdown|daysUntil|daysBetween|todayIso\(\)\s*[<>]/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('logs nothing: no console call anywhere in the runtime', () => {
    for (const file of RUNTIME) expect({ file, hit: /\bconsole\./.test(code(file)) }).toEqual({ file, hit: false });
  });

  it('adds no status, archive, filter, grouping or person entity', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /archiv|\bstatus\b|Recipient|recipientId|personId|occasionId|GiftIdea|GiftStatus|groupBy|filterBy|SearchBar|searchQuery/.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('adds no field beyond the nine persisted keys', () => {
    const type = code('types/gift.ts').match(/export interface Gift \{([\s\S]*?)\}/)![1];
    expect(type.split(';').map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean)).toEqual([
      'id: string', 'personLabel: string', 'idea: string', 'occasionLabel?: string', 'occasionDate?: string', 'budget?: MinorUnits',
      'purchasedOn?: string', 'paid?: MinorUnits', 'createdAt: string',
    ]);
  });
});

describe('APP-069 never lets a gift reach a log, an analytics event or a generic event', () => {
  const PERSON = 'Sentinel Person Ørsted';
  const IDEA = 'Sentinel gift idea';
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });
  afterEach(() => spies.forEach((spy) => spy.mockRestore()));

  it('through create, edit, purchase, delete, backup export, restore and a corrupt hydrate, nothing is written to the console', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { useGiftsStore } = require('@/store/useGiftsStore') as typeof import('@/store/useGiftsStore');
    const store = () => useGiftsStore.getState();

    store().addGift({ personLabel: PERSON, idea: IDEA, occasionLabel: 'Sentinel birthday', budget: '123,45', purchased: false });
    const id = store().gifts[0].id;
    store().updateGift(id, { personLabel: PERSON, idea: IDEA, budget: '123,45', purchased: true, purchasedOn: '2026-10-01', paid: '99' });
    store().addGift({ personLabel: PERSON, idea: IDEA, budget: '-1', purchased: false });
    store().exportBackup();
    store().restoreBackup({ gifts: [{ id: 'x', personLabel: PERSON, idea: IDEA, createdAt: '2026-10-12T09:30:00.000Z' }] });
    store().restoreBackup({ gifts: [{ id: 'bad', personLabel: PERSON, idea: IDEA, createdAt: 'nope' }] });
    await AsyncStorage.setItem('lifesort-gifts', '{ corrupt');
    await useGiftsStore.persist.rehydrate();
    store().removeGift('x');
    store().clearLocal();
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = spies.flatMap((spy) => spy.mock.calls);
    expect(JSON.stringify(calls)).not.toMatch(/Sentinel|123|99|2026-10-01/);
  });

  it('puts no gift into any event: the domain events and analytics modules are never touched', () => {
    for (const file of RUNTIME) {
      expect({ file, hit: /trackEvent|logEvent|emit\(|dispatchEvent|EventEmitter|analytics|domainEvent|DomainEvent/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });
});

describe('APP-069 adds no Home, Life, Search or reminder surface', () => {
  it('the Gifts module registers no Home snapshot, Search entries, notification category or data-rights handler', () => {
    const gifts = getModule('gifts') as unknown as Record<string, unknown>;
    expect(Object.keys(gifts).filter((key) => ['homeSnapshot', 'searchEntries', 'notificationCategory', 'exportHandler', 'deleteHandler', 'requiredEntitlements'].includes(key))).toEqual([]);
  });

  it('Home snapshots, the Home tab, the Life tab, Search and the monthly review never mention Gifts', () => {
    for (const file of ['features/homeSnapshots.ts', 'core/modules/homeSnapshots.ts', 'app/(tabs)/index.tsx', 'app/(tabs)/life.tsx', 'app/search.tsx', 'features/monthlyReview.ts', 'core/modules/monthlyReview.ts', 'core/modules/homeRanking.ts', 'core/modules/moduleSearch.ts']) {
      expect({ file, hit: /gift/i.test(code(file)) }).toEqual({ file, hit: false });
    }
    for (const locale of ['en', 'da']) {
      for (const namespace of ['life', 'home', 'search', 'review']) {
        const text = fs.readFileSync(path.join(ROOT, `localization/locales/${locale}/${namespace}.json`), 'utf8');
        expect({ locale, namespace, hit: /\bgift|\bgave/i.test(text) }).toEqual({ locale, namespace, hit: false });
      }
    }
  });

  it('the module launcher is the only entry point: no other screen routes to /gifts', () => {
    const linking = sourceFiles('app', 'components', 'features', 'core', 'hooks')
      .filter((file) => !file.startsWith('app/gifts/') && !file.includes('/gifts/'))
      .filter((file) => /['"`]\/gifts/.test(code(file)));
    // The launcher navigates there; the module registry only declares which routes the module owns.
    expect(linking).toEqual(['app/modules.tsx', 'core/modules/moduleRegistry.ts']);
    expect(code('core/modules/moduleRegistry.ts')).toContain("routeRoots: ['/gifts']");
  });
});

describe('APP-070 Contacts: one iOS adapter, one name, nothing else (ADR-0057)', () => {
  const PLAIN = [
    'store/useGiftsStore.ts', 'types/gift.ts', 'app/gifts/index.tsx', 'app/gifts/new.tsx', 'app/gifts/[id].tsx',
    ...listFiles('core/gifts'), ...listFiles('features/gifts/domain'),
  ];

  it('the adapter is the only file in features/gifts/contacts, and the domain stays one file', () => {
    expect(listFiles('features/gifts/contacts')).toEqual([ADAPTER]);
    expect(listFiles('features/gifts/domain')).toEqual(['features/gifts/domain/gift.ts']);
    expect(listFiles('features/gifts').sort()).toEqual([ADAPTER, 'features/gifts/domain/gift.ts']);
  });

  it('B1/B2/B3/B4/B5: the adapter loads only expo-contacts/legacy, and only to open the single-contact picker', () => {
    expect(importsOf(ADAPTER).filter((s) => /contacts/i.test(s))).toEqual(expect.arrayContaining(['expo-contacts/legacy']));
    expect(new Set(importsOf(ADAPTER).filter((s) => /contacts/i.test(s)))).toEqual(new Set(['expo-contacts/legacy']));
    const text = code(ADAPTER);
    // No permission API (B1, B2), no new-API picker or access picker or button (B3), no enumeration or lookup (B4),
    // no write (B5), no groups or containers.
    expect(text).not.toMatch(/requestPermission|getPermission|PermissionsAsync|PermissionResponse|presentPicker|presentAccessPicker|ContactAccessButton|expo-contacts\/next|from ['"]expo-contacts['"]/);
    expect(text).not.toMatch(/getContacts|getContactById|getContactsAsync|getAll|getAllDetails|getCount|hasAny|\.search|getGroups|getContainers|getDefaultContainer|Group\b|Container\b/);
    expect(text).not.toMatch(/addContact|updateContact|removeContact|deleteContact|createContact|\.create\(|\.update\(|\.patch\(|\.delete\(|\.add\w*\(|\.remove\w*\(|writeContact|presentCreateForm|editWithForm|presentFormAsync|shareContact/);
    expect(text.match(/presentContactPickerAsync/g)).toHaveLength(1);
  });

  it('B6/B11: the adapter reads only firstName and lastName, and returns nothing but { ok, name } or a reason code', () => {
    const text = code(ADAPTER);
    expect(text).not.toMatch(/phoneNumbers|emails|birthday|company|imageAvailable|\bimage\b|addresses|contactType|jobTitle|department|\bnote\b|nickname|middleName|namePrefix|nameSuffix|maidenName|relationships|urlAddresses|socialProfiles|instantMessage|lookupKey|\.id\b|\bid\s*[:,}]|\.name\b|rawContacts|phonetic/);
    expect(text.match(/\b(?:firstName|lastName)\b/g)?.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/return\s+(?:picked|contact)\b|ok:\s*true,\s*(?:contact|picked|\.\.\.)/);
    // Native error text can carry an identifier: it is never read, returned or logged.
    expect(text).not.toMatch(/\.message|\.stack|String\(error\)|JSON\.stringify/);
  });

  it('B8: the adapter logs nothing', () => {
    expect(code(ADAPTER)).not.toMatch(/\bconsole\b|logger|safeLog|reportError|captureException|Sentry/i);
  });

  it('the adapter fails closed off iOS before it loads anything', () => {
    const text = code(ADAPTER);
    expect(text).toMatch(/Platform\.OS\s*===\s*'ios'/);
    expect(text.indexOf('isContactPickerSupported()')).toBeLessThan(text.indexOf("require('expo-contacts/legacy')"));
    // Lazy: no static import of the native package, so Gifts renders without it.
    expect(importsOf(ADAPTER).filter((s) => s.startsWith('expo-contacts')).length).toBeGreaterThan(0);
    expect(code(ADAPTER)).not.toMatch(/^\s*import[^;]*['"]expo-contacts/m);
  });

  it('nothing but the adapter loads expo-contacts, anywhere in the app', () => {
    const importers = sourceFiles('app', 'components', 'core', 'features', 'store', 'utils', 'hooks', 'lib', 'types', 'constants')
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith('expo-contacts')));
    expect(importers).toEqual([ADAPTER]);
  });

  it('B7: the Gift type, the persisted format, the domain, the store and the screens have no Contact concept at all', () => {
    for (const file of PLAIN) {
      expect({ file, hit: /contact|READ_CONTACTS|CNContact|phoneNumbers?|\bphone\b|\bemails?\b|\bavatar\b|birthday|relationship/i.test(code(file)) }).toEqual({ file, hit: false });
    }
    expect(code('types/gift.ts')).not.toMatch(/contact|phone|email|avatar|birthday|organi[sz]ation|address|relationship/i);
  });

  it('B11: GiftForm receives the normalised result only: it imports the adapter and nothing else from Contacts', () => {
    const file = 'components/GiftForm.tsx';
    expect(importsOf(file).filter((s) => /contact/i.test(s))).toEqual(['@/features/gifts/contacts/pickContactName']);
    const text = code(file);
    expect(text).not.toMatch(/expo-contacts|ExistingContact|\bContact\b|contactId|contactIdentifier|READ_CONTACTS|CNContact|requestPermission|getPermission|phoneNumbers?|\bphone\b|\bemails?\b|\bavatar\b|birthday|relationship|company|imageAvailable/);
    // The component keeps a reason code and a name string, never a contact object.
    expect(text).toContain('result.name');
    expect(text).not.toMatch(/useState<[^>]*Contact\b|setContact\(|contactRecord|rawContact/);
    // The adapter's answer is only ever read through .ok, .name and .reason: it is never stored, passed on or serialised whole.
    expect([...text.matchAll(/\bresult\b(?!\.(?:ok|name|reason)\b)/g)]).toHaveLength(1); // the `const result = await pickContactName()` declaration
    // Only the form's own explicit handler calls the adapter, and never on mount.
    expect(text.match(/pickContactName\(/g)).toHaveLength(1);
    expect(text).not.toMatch(/useEffect|useFocusEffect|useLayoutEffect/);
  });

  it('GiftForm shows the action only where the adapter supports it, never on Android or web', () => {
    const text = code('components/GiftForm.tsx');
    expect(text).toContain('isContactPickerSupported()');
    expect(text).not.toMatch(/Platform\.OS\s*[!=]==\s*'(?:android|web)'/);
  });

  it('B12: the adapter and the form import no Supabase, network, sync or analytics', () => {
    for (const file of [ADAPTER, 'components/GiftForm.tsx']) {
      expect({ file, hit: /supabase|\bfetch\(|XMLHttpRequest|WebSocket|outbox|analytics|trackEvent|AsyncStorage|SecureStore|useGiftsStore/i.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('no Contacts API call exists anywhere in the app outside the adapter (permission, enumeration, picker, write, button)', () => {
    const everywhere = sourceFiles('app', 'components', 'core', 'features', 'store', 'utils', 'hooks', 'lib', 'types', 'constants').filter((file) => file !== ADAPTER);
    for (const file of everywhere) {
      expect({ file, hit: /presentContactPickerAsync|getContactsAsync|ContactAccessButton|presentAccessPicker|Contacts\.(?:requestPermissionsAsync|getPermissionsAsync)|expo-contacts/.test(code(file)) }).toEqual({ file, hit: false });
    }
  });

  it('B13: the backup format was not bumped and the Gift schema was not widened', () => {
    expect(code('utils/shared/backupValidation.ts')).toMatch(/export const BACKUP_VERSION = 14;/);
    expect(code('core/gifts/persistedGift.ts')).not.toMatch(/contact/i);
  });
});

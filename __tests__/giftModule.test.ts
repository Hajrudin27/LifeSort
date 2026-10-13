/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { parseModuleFlags, resolveModuleAvailability } from '@/core/feature-flags/moduleFlags';
import { evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import {
  canToggleModule,
  discoverableToggleableModuleIds,
  enabledModuleIds,
  isModuleEnabled,
  parseModuleEnablementRows,
  TOGGLEABLE_MODULE_IDS,
} from '@/core/modules/moduleEnablement';
import { getModule, MODULE_IDS, moduleAccess } from '@/core/modules/moduleRegistry';
import { isWriteRoute, moduleForPath } from '@/core/modules/moduleRoutes';
import {
  DATA_DOMAINS,
  PERSISTENCE_SURFACES,
  getDataDomain,
  getPersistenceSurface,
  isMixedProfilePersistenceSurface,
  localStorageProtectionForSurface,
  persistenceSurfaceContainsProfileB,
} from '@/core/storage/dataProfileRegistry';

/**
 * APP-069 — the Gifts module as the platform sees it: registered, internal at merge, reachable
 * only from the launcher, classified Profile A and local-only, and in both languages.
 */
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const json = (locale: string, namespace: string) => JSON.parse(read(`localization/locales/${locale}/${namespace}.json`));

describe('registration', () => {
  it('registers gifts, once, in the module list', () => {
    expect(MODULE_IDS.filter((id) => id === 'gifts')).toEqual(['gifts']);
    expect(getModule('gifts').id).toBe('gifts');
  });

  it('merges as INTERNAL, not available: activation is a separate change after manual QA', () => {
    expect(getModule('gifts').availability).toBe('internal');
  });

  it('is classified personal and financial, and nothing else', () => {
    expect(getModule('gifts').sensitivity.slice().sort()).toEqual(['financial', 'personal']);
  });

  it('owns /gifts and nothing else', () => {
    expect(getModule('gifts').routeRoots).toEqual(['/gifts']);
    for (const path of ['/gifts', '/gifts/new', '/gifts/some-id']) expect(moduleForPath(path)).toBe('gifts');
    expect(moduleForPath('/giftsomething')).toBe('core-shell');
  });

  it('has no Home snapshot, Search entries, notification category, entitlement or data-rights handler', () => {
    const definition = getModule('gifts');
    expect(definition.homeSnapshot).toBeUndefined();
    expect(definition.searchEntries).toBeUndefined();
    expect(definition.notificationCategory).toBeUndefined();
    expect(definition.requiredEntitlements).toBeUndefined();
    expect(definition.exportHandler).toBeUndefined();
    expect(definition.deleteHandler).toBeUndefined();
  });

  it('is reachable through the inventory: the module register row says internal', () => {
    const inventory = read('docs/app-inventory.md');
    expect(inventory).toMatch(/^\| `gifts` \| `gifts` \| internal /m);
    expect(inventory).toMatch(/^\| `gifts` \| `gifts` \| internal .*\| `\/gifts\/\*` \| `useGiftsStore` \| personal, financial \|/m);
  });
});

describe('internal availability behaves as the existing module architecture says', () => {
  it('is closed to an ordinary user: not in navigation, not openable, no existing data, nothing creatable', () => {
    expect(moduleAccess('gifts')).toEqual({
      showInNavigation: false, canOpenModule: false, canViewExistingData: false, canCreate: false, canEdit: false,
      canExportData: true, canDeleteData: true, status: 'internal-only',
    });
  });

  it('keeps the data rights for every state, as for every module', () => {
    for (const availability of ['hidden', 'internal', 'beta', 'available', 'maintenance', 'retired'] as const) {
      expect(evaluateModuleAccess(availability)).toMatchObject({ canExportData: true, canDeleteData: true });
    }
  });

  it('opens fully for an internal viewer, without inventing an internal-user model here', () => {
    expect(evaluateModuleAccess('internal', { isInternalUser: true, isBetaTester: false })).toMatchObject({ canOpenModule: true, canCreate: true });
    expect(read('core/modules/moduleAvailability.ts')).toContain('isInternalUser: false');
  });

  it('can be restricted by the existing remote flag but can never be publicly promoted', () => {
    expect(resolveModuleAvailability('gifts', {})).toBe('internal');
    expect(parseModuleFlags([{ module_id: 'gifts', availability: 'available' }])).toEqual({ gifts: 'available' });
    expect(resolveModuleAvailability('gifts', { gifts: 'available' })).toBe('internal');
    expect(evaluateModuleAccess(resolveModuleAvailability('gifts', { gifts: 'maintenance' }))).toMatchObject({ canViewExistingData: false, canCreate: false, canExportData: true });
  });

  it('does not depend on Economy: switching Economy off, or killing it, changes nothing for Gifts', () => {
    const overrides = parseModuleFlags([
      { module_id: 'economy', availability: 'retired' },
      { module_id: 'gifts', availability: 'available' },
    ]);
    expect(resolveModuleAvailability('economy', overrides)).toBe('retired');
    expect(resolveModuleAvailability('gifts', overrides)).toBe('internal');
    expect(evaluateModuleAccess(resolveModuleAvailability('gifts', overrides))).toMatchObject({ canOpenModule: false, canCreate: false });
    expect(isModuleEnabled('gifts', { economy: false })).toBe(true);
    expect(moduleForPath('/gifts/new')).toBe('gifts');
    expect(moduleForPath('/economy')).toBe('economy');
  });

  it('blocks create and edit routes in maintenance through the existing write-route rule', () => {
    expect(isWriteRoute('/gifts/new')).toBe(true);
  });
});

describe('module choice handles the id with no server schema work', () => {
  it('is toggleable, on by default, and a user\'s choice is read from the existing user_modules rows', () => {
    expect(canToggleModule('gifts')).toBe(true);
    expect(TOGGLEABLE_MODULE_IDS).toContain('gifts');
    expect(isModuleEnabled('gifts', {})).toBe(true);
    expect(enabledModuleIds({})).toContain('gifts');
    expect(parseModuleEnablementRows([{ module_id: 'gifts', enabled: false }])).toEqual({ gifts: false });
    expect(isModuleEnabled('gifts', { gifts: false })).toBe(false);
  });

  it('needs no migration: the user_modules and module_flags constraints exclude only the platform modules', () => {
    for (const file of ['supabase/migrations/20260908233100_user_modules.sql', 'supabase/migrations/20260908233000_module_flags.sql']) {
      expect(read(file)).toContain("check (module_id not in ('core-shell', 'account'))");
    }
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'));
    expect(migrations.filter((file) => /gift/i.test(file))).toEqual([]);
  });
});

describe('the module launcher', () => {
  const launcher = read('app/modules.tsx');
  const keysOf = (block: RegExpMatchArray | null) => [...(block?.[1] ?? '').matchAll(/^\s*['"]?([a-z-]+)['"]?\s*:/gm)].map((m) => m[1]);
  const iconKeys = keysOf(launcher.match(/const MODULE_ICONS[^=]*=\s*\{([\s\S]*?)\n\};/));
  const routeKeys = keysOf(launcher.match(/const MODULE_ROUTES[^=]*=\s*\{([\s\S]*?)\n\};/));

  it('has an icon and a route for gifts', () => {
    expect(launcher).toContain("gifts: { ios: 'gift.fill', android: 'redeem', web: 'redeem' },");
    expect(launcher).toContain("gifts: '/gifts',");
  });

  it('has an icon and a route for every publicly discoverable module, so no public launcher item is a dead end', () => {
    for (const id of discoverableToggleableModuleIds()) {
      expect({ id, icon: iconKeys.includes(id), route: routeKeys.includes(id) }).toEqual({ id, icon: true, route: true });
    }
  });

  it('points at a route file that exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/gifts/index.tsx'))).toBe(true);
  });
});

describe('routes', () => {
  it('are exactly the list, the create screen and the edit screen: no recipient or occasion route', () => {
    const files = fs.readdirSync(path.join(ROOT, 'app/gifts')).sort();
    expect(files).toEqual(['[id].tsx', 'index.tsx', 'new.tsx']);
  });

  it('are thin: the screens hold no rules, no storage and no network', () => {
    for (const file of ['app/gifts/index.tsx', 'app/gifts/new.tsx', 'app/gifts/[id].tsx']) {
      const text = read(file);
      expect(text.split('\n').length).toBeLessThan(140);
      expect(text).not.toMatch(/AsyncStorage|supabase|validateGiftInput|createGift|newEntityId/);
    }
  });

  it('get a title from the layout, and the create screen is a modal like the other create screens', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('name="gifts/index"');
    expect(layout).toContain('name="gifts/new"');
    expect(layout).toContain('name="gifts/[id]"');
    expect(layout).toMatch(/name="gifts\/new"\s*options=\{\{\s*presentation: "modal"/);
    expect(layout).not.toMatch(/gifts\/(recipient|occasion)/);
  });
});

describe('data classification (ADR-0022): Profile A, device-local, no sync', () => {
  const domain = getDataDomain('gifts.gifts')!;

  it('registers one logical domain, gifts.gifts, in the gifts module', () => {
    expect(DATA_DOMAINS.filter((d) => d.module === 'gifts').map((d) => d.id)).toEqual(['gifts.gifts']);
    expect(domain.module).toBe('gifts');
  });

  it('is Profile A with no server sync expected, and is client-authoritative and user-owned', () => {
    expect(domain).toMatchObject({
      profile: 'A', expectsServerSync: false, expectsLocalCopy: 'expected', clientAuthoritative: true, userOwned: true,
      plaintextLocalPersistenceAllowed: true, encryptedLocalPersistenceRequired: false, canonicalAuthority: 'client',
    });
  });

  it('records why Profile A is right: third-party labels and planning amounts, not a Profile B domain', () => {
    expect(domain.description).toMatch(/third-party personal data/i);
    expect(domain.description).toMatch(/personal financial planning values/i);
    expect(domain.description).toMatch(/personal, financial/);
    expect(domain.description).toMatch(/neither makes the domain Profile B/i);
    expect(domain.description).toMatch(/no table/i);
  });

  it('lives on exactly one physical surface: a plain, unmixed, unencrypted AsyncStorage key', () => {
    expect(domain.storageSurfaces).toEqual(['async-storage:lifesort-gifts']);
    const surface = getPersistenceSurface('async-storage:lifesort-gifts')!;
    expect(surface.containsDomains).toEqual(['gifts.gifts']);
    expect(surface.location).toBe('device');
    expect(isMixedProfilePersistenceSurface(surface.id)).toBe(false);
    expect(persistenceSurfaceContainsProfileB(surface.id)).toBe(false);
    expect(localStorageProtectionForSurface(surface.id)).toBe('plaintext-allowed');
    expect(surface.migration).toMatchObject({ kind: 'external', currentVersion: 0, owner: 'store/useGiftsStore.ts' });
  });

  it('has no Supabase table, bucket or SecureStore key', () => {
    const forGifts = PERSISTENCE_SURFACES.filter((s) => s.containsDomains.includes('gifts.gifts' as never));
    expect(forGifts.map((s) => s.kind)).toEqual(['async-storage']);
  });

  it('names the files that implement it as evidence, and they exist', () => {
    for (const file of domain.evidence) expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });
});

describe('English and Danish copy', () => {
  const paths = (node: unknown, prefix = ''): string[] =>
    typeof node === 'object' && node !== null
      ? Object.entries(node).flatMap(([key, value]) => paths(value, `${prefix}${prefix ? '.' : ''}${key}`))
      : [prefix];
  const value = (locale: string, key: string) => key.split('.').reduce<any>((node, part) => node?.[part], json(locale, 'gifts'));
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it('has the same keys in both languages, none empty', () => {
    expect(paths(json('da', 'gifts')).sort()).toEqual(paths(json('en', 'gifts')).sort());
    for (const locale of ['en', 'da']) {
      for (const key of paths(json(locale, 'gifts'))) {
        const text = value(locale, key);
        expect({ locale, key, ok: typeof text === 'string' && text.trim().length > 0 }).toEqual({ locale, key, ok: true });
      }
    }
  });

  it('uses the same interpolation placeholders in both languages', () => {
    for (const key of paths(json('en', 'gifts'))) {
      expect({ key, da: placeholders(value('da', key)) }).toEqual({ key, da: placeholders(value('en', key)) });
    }
  });

  it('defines every gifts.* key the runtime uses, and every error code the domain can return', () => {
    const files = ['app/gifts/index.tsx', 'app/gifts/new.tsx', 'app/gifts/[id].tsx', 'components/GiftForm.tsx'];
    const used = new Set(files.flatMap((file) => [...read(file).matchAll(/t\(\s*['"`](gifts\.[A-Za-z.]+)['"`]/g)].map((m) => m[1].replace(/^gifts\./, ''))));
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) expect({ key, en: typeof value('en', key), da: typeof value('da', key) }).toEqual({ key, en: 'string', da: 'string' });
    const domain = read('features/gifts/domain/gift.ts');
    const codes = [...domain.match(/export type GiftErrorCode =([\s\S]*?);/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) expect({ code, en: typeof value('en', `errors.${code}`), da: typeof value('da', `errors.${code}`) }).toEqual({ code, en: 'string', da: 'string' });
  });

  it('hard-codes no user-facing string in the runtime: every visible text goes through t()', () => {
    for (const file of ['app/gifts/index.tsx', 'app/gifts/new.tsx', 'app/gifts/[id].tsx', 'components/GiftForm.tsx']) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
      // JSX text between tags that is not an expression.
      const jsxText = [...text.matchAll(/>\s*([A-Za-z][^<>{}]*[A-Za-z.])\s*</g)].map((m) => m[1]).filter((s) => !/^\s*$/.test(s));
      expect({ file, jsxText }).toEqual({ file, jsxText: [] });
    }
  });

  it('names the module and describes it in both languages', () => {
    expect(json('en', 'modules').names.gifts).toBe('Gifts');
    expect(json('da', 'modules').names.gifts).toBe('Gaver');
    expect(json('en', 'modules').descriptions.gifts).toMatch(/gift/i);
    expect(json('da', 'modules').descriptions.gifts).toMatch(/gave/i);
  });

  it('says the planned budget and the paid amount apart, in DKK, and says a purchase is not an expense', () => {
    expect(value('en', 'budgetLabel')).toMatch(/planned budget.*DKK/i);
    expect(value('en', 'paidLabel')).toMatch(/paid.*DKK/i);
    expect(value('da', 'budgetLabel')).toMatch(/planlagt budget.*DKK/i);
    expect(value('da', 'paidLabel')).toMatch(/betalt.*DKK/i);
    expect(value('en', 'notAddedToExpenses')).toBe('Not added to your expenses.');
    expect(value('da', 'notAddedToExpenses')).toBe('Ikke tilføjet til dine udgifter.');
    // The note says nothing about syncing with Economy.
    expect(`${value('en', 'notAddedToExpenses')} ${value('da', 'notAddedToExpenses')}`).not.toMatch(/sync|synk|economy|økonomi/i);
  });

  it('is neutral when empty, and says deletion is on this device only', () => {
    expect(value('en', 'emptyState')).toBe('No gift ideas yet.');
    expect(value('da', 'emptyState')).toBe('Ingen gaveidéer endnu.');
    expect(`${value('en', 'emptyState')} ${value('da', 'emptyState')}`).not.toMatch(/!|forgot|glemt|don't|bør|should|skal du/i);
    expect(value('en', 'deleteConfirmMessage')).toMatch(/this device only/i);
    expect(value('da', 'deleteConfirmMessage')).toMatch(/kun på denne enhed/i);
    expect(value('en', 'deleteConfirmMessage')).toMatch(/purchase details/i);
  });
});

describe('what ships with it', () => {
  it('has the ADR, listed in the register and accepted', () => {
    const readme = read('docs/adr/README.md');
    expect(readme).toMatch(/\| \[0056\]\(\.\/0056-[a-z0-9-]+\.md\) \| .+ \| Accepted \| 2026-10-12 \| APP-069 \|/);
    const adr = fs.readdirSync(path.join(ROOT, 'docs/adr')).filter((file) => file.startsWith('0056-'));
    expect(adr).toHaveLength(1);
    expect(read(`docs/adr/${adr[0]}`)).toMatch(/\*\*Story\*\* \| APP-069/);
  });

  it('has the story document, and it never calls Gifts cloud-synced', () => {
    const doc = read('docs/app-069-gift-planner.md');
    expect(doc).toMatch(/device-only|local-only/i);
    // Every mention of syncing is a denial: "not cloud-synced", never a claim.
    for (const match of doc.matchAll(/cloud-synced|syncs across|synced across/gi)) {
      expect({ context: doc.slice(Math.max(0, match.index! - 12), match.index), denied: /\bnot\W*$/i.test(doc.slice(Math.max(0, match.index! - 12), match.index)) })
        .toMatchObject({ denied: true });
    }
    expect(doc).toMatch(/reinstall/i);
    expect(doc).toMatch(/deviation/i);
  });
});

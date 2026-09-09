/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import {
  DATA_DOMAINS,
  PERSISTENCE_SURFACES,
  domainsByProfile,
  domainsForPersistenceSurface,
  getDataDomain,
  getPersistenceSurface,
  isMixedProfilePersistenceSurface,
  localPlaintextPersistenceAllowedForSurface,
  localStorageProtectionForSurface,
  mixedProfilePersistenceSurfaces,
  persistenceSurfaceContainsProfileB,
  profileForDomain,
  profilesForPersistenceSurface,
  type DataProfileContract,
} from '@/core/storage/dataProfileRegistry';

const REPO_ROOT = path.resolve(__dirname, '..');
const CODE_DIRS = ['app', 'store', 'utils', 'hooks', 'components', 'core', 'lib', 'features'];
const PROFILE_VALUES = ['A', 'B', 'C', 'D'];
const BACKEND_ONLY_TABLES = [
  'activity_log',
  'admin_users',
  'rate_limits',
  'support_tickets',
  'timeline_events',
  'waitlist_signups',
];
const MOBILE_ADJACENT_MIGRATION_TABLES = ['global_recipes', 'products'];

// These are compile-time checks. If the discriminated profile contracts ever
// accept these shapes, tsc will fail because the @ts-expect-error is unused.
const invalidSensitiveContract = {
  profile: 'B',
  expectsLocalCopy: 'expected',
  expectsServerSync: true,
  plaintextLocalPersistenceAllowed: true,
  encryptedLocalPersistenceRequired: true,
  clientAuthoritative: true,
  normalClientWritable: true,
  globallyReadableReference: false,
  userOwned: true,
  canonicalAuthority: 'client',
// @ts-expect-error Profile B cannot permit plaintext local persistence.
} satisfies DataProfileContract;

const invalidServerAuthoritativeContract = {
  profile: 'C',
  expectsLocalCopy: 'minimal-cache',
  expectsServerSync: false,
  plaintextLocalPersistenceAllowed: false,
  encryptedLocalPersistenceRequired: false,
  clientAuthoritative: true,
  normalClientWritable: false,
  globallyReadableReference: false,
  userOwned: false,
  canonicalAuthority: 'server',
// @ts-expect-error Profile C cannot be client-authoritative.
} satisfies DataProfileContract;

const invalidReferenceContract = {
  profile: 'D',
  expectsLocalCopy: 'versioned-cache',
  expectsServerSync: false,
  plaintextLocalPersistenceAllowed: true,
  encryptedLocalPersistenceRequired: false,
  clientAuthoritative: false,
  normalClientWritable: true,
  globallyReadableReference: true,
  userOwned: true,
  canonicalAuthority: 'admin-pipeline',
// @ts-expect-error Profile D cannot be normal-client writable or user-owned.
} satisfies DataProfileContract;

void invalidSensitiveContract;
void invalidServerAuthoritativeContract;
void invalidReferenceContract;

function walkFiles(dir: string, predicate: (file: string) => boolean): string[] {
  const root = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(root)) return [];

  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (predicate(full)) found.push(path.relative(REPO_ROOT, full));
    }
  };
  walk(root);
  return found.sort();
}

function sourceFiles(dirs = CODE_DIRS): string[] {
  return dirs.flatMap((dir) => walkFiles(dir, (file) => file.endsWith('.ts') || file.endsWith('.tsx')));
}

function sourceText(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function persistKeysInStores(): string[] {
  return unique(
    sourceFiles(['store'])
      .flatMap((file) => [...sourceText(file).matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])),
  );
}

function tablesReferencedByClient(): string[] {
  return unique(
    sourceFiles()
      .flatMap((file) => [...sourceText(file).matchAll(/\.from\(['"]([a-z][a-z0-9_]*)['"]\)/g)].map((match) => match[1])),
  );
}

function tablesCreatedByMigrations(): string[] {
  return unique(
    walkFiles('supabase/migrations', (file) => file.endsWith('.sql')).flatMap((file) => {
      const sql = sourceText(file);
      return [
        ...[...sql.matchAll(/CREATE TABLE\s+"public"\."([a-z][a-z0-9_]*)"/gi)].map((match) => match[1]),
        ...[...sql.matchAll(/create table(?:\s+if not exists)?\s+public\.([a-z][a-z0-9_]*)/gi)].map((match) => match[1]),
      ];
    }),
  );
}

function bucketsInCodeAndMigrations(): string[] {
  return unique(
    [
      ...sourceFiles().flatMap((file) =>
        [...sourceText(file).matchAll(/storage\.from\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]),
      ),
      ...walkFiles('supabase/migrations', (file) => file.endsWith('.sql')).flatMap((file) =>
        [...sourceText(file).matchAll(/(?:bucket_id\s*=\s*|values\s*\()['"]([a-z0-9-]+)['"]/g)].map((match) => match[1]),
      ),
    ].filter((bucket) => ['attachments', 'recipe-images'].includes(bucket)),
  );
}

const registeredDomainIds = DATA_DOMAINS.map((domain) => domain.id);
const registeredSurfaceIds = PERSISTENCE_SURFACES.map((surface) => surface.id);

describe('APP-027 logical domain contracts', () => {
  it('registers every domain under one valid profile with no duplicate ids', () => {
    expect(new Set(registeredDomainIds).size).toBe(DATA_DOMAINS.length);

    for (const domain of DATA_DOMAINS) {
      expect(PROFILE_VALUES).toContain(domain.profile);
      expect(domain.storageSurfaces.length).toBeGreaterThan(0);
      expect(domain.evidence.length).toBeGreaterThan(0);
      expect(profileForDomain(domain.id)).toBe(domain.profile);
    }
  });

  it('enforces the profile invariants at runtime too', () => {
    for (const domain of DATA_DOMAINS) {
      if (domain.profile === 'B') {
        expect(domain.encryptedLocalPersistenceRequired).toBe(true);
        expect(domain.plaintextLocalPersistenceAllowed).toBe(false);
      }
      if (domain.profile === 'C') {
        expect(domain.clientAuthoritative).toBe(false);
        expect(domain.normalClientWritable).toBe(false);
        expect(domain.canonicalAuthority).toBe('server');
      }
      if (domain.profile === 'D') {
        expect(domain.clientAuthoritative).toBe(false);
        expect(domain.normalClientWritable).toBe(false);
        expect(domain.userOwned).toBe(false);
        expect(domain.globallyReadableReference).toBe(true);
      }
    }
  });

  it('has deterministic lookups and fail-closed unknown handling', () => {
    const known = DATA_DOMAINS[0];
    expect(getDataDomain(known.id)).toBe(known);
    expect(getDataDomain('missing.domain')).toBeNull();

    const surface = PERSISTENCE_SURFACES[0];
    expect(getPersistenceSurface(surface.id)).toBe(surface);
    expect(getPersistenceSurface('async-storage:missing')).toBeNull();

    expect(localPlaintextPersistenceAllowedForSurface('async-storage:missing')).toBe(false);
    expect(persistenceSurfaceContainsProfileB('async-storage:missing')).toBe(true);
    expect(isMixedProfilePersistenceSurface('async-storage:missing')).toBe(true);
    expect(localStorageProtectionForSurface('async-storage:missing')).toBe('no-plaintext-cache');
    expect(() => domainsForPersistenceSurface('async-storage:missing')).toThrow(/Unknown persistence surface/);
  });

  it('keeps the profile counts explicit', () => {
    expect({
      A: domainsByProfile('A').length,
      B: domainsByProfile('B').length,
      C: domainsByProfile('C').length,
      D: domainsByProfile('D').length,
    }).toEqual({ A: 23, B: 6, C: 2, D: 4 });
  });
});

describe('APP-027 physical persistence surfaces', () => {
  it('has no duplicate physical surface ids and no dangling domain references', () => {
    expect(PERSISTENCE_SURFACES).toHaveLength(83);
    expect(new Set(registeredSurfaceIds).size).toBe(PERSISTENCE_SURFACES.length);

    for (const surface of PERSISTENCE_SURFACES) {
      expect(surface.containsDomains.length).toBeGreaterThan(0);
      for (const domainId of surface.containsDomains) {
        expect(registeredDomainIds).toContain(domainId);
        expect(getDataDomain(domainId)?.storageSurfaces).toContain(surface.id);
      }
    }

    for (const domain of DATA_DOMAINS) {
      for (const surfaceId of domain.storageSurfaces) {
        expect(registeredSurfaceIds).toContain(surfaceId);
        expect(getPersistenceSurface(surfaceId)?.containsDomains).toContain(domain.id);
      }
    }
  });

  it('accounts for every current Zustand persist key', () => {
    const registeredZustandKeys = PERSISTENCE_SURFACES
      .filter((surface) => surface.kind === 'async-storage')
      .map((surface) => surface.id.replace(/^async-storage:/, ''))
      .filter((key) => !['lifesort-verification-last-sent', 'supabase-session-web-or-legacy'].includes(key))
      .sort();

    expect(registeredZustandKeys).toEqual(persistKeysInStores());
  });

  it('accounts for direct AsyncStorage keys outside Zustand persist', () => {
    expect(getPersistenceSurface('async-storage:lifesort-verification-last-sent')).toBeTruthy();
    expect(sourceText('core/auth/emailVerification.ts')).toContain("const LAST_SENT_KEY = 'lifesort-verification-last-sent'");
    expect(getPersistenceSurface('async-storage:supabase-session-web-or-legacy')).toBeTruthy();
    expect(sourceText('utils/auth/secureSessionStorage.ts')).toContain('migrateFromAsyncStorage');
  });

  it('accounts for every client-referenced Supabase table', () => {
    const registeredTables = PERSISTENCE_SURFACES
      .filter((surface) => surface.kind === 'supabase-table')
      .map((surface) => surface.id.replace(/^supabase-table:/, ''));

    const missing = tablesReferencedByClient().filter((table) => !registeredTables.includes(table));
    expect(missing).toEqual([]);
  });

  it('keeps backend-only migration tables outside the mobile registry', () => {
    const registeredTables = PERSISTENCE_SURFACES
      .filter((surface) => surface.kind === 'supabase-table')
      .map((surface) => surface.id.replace(/^supabase-table:/, ''));

    for (const table of BACKEND_ONLY_TABLES) {
      expect(tablesCreatedByMigrations()).toContain(table);
      expect(tablesReferencedByClient()).not.toContain(table);
      expect(registeredTables).not.toContain(table);
    }
  });

  it('does not silently invent Supabase table surfaces', () => {
    const migrationTables = tablesCreatedByMigrations();
    const clientTables = tablesReferencedByClient();
    const registeredTables = PERSISTENCE_SURFACES
      .filter((surface) => surface.kind === 'supabase-table')
      .map((surface) => surface.id.replace(/^supabase-table:/, ''))
      .sort();

    expect(registeredTables.every((table) => migrationTables.includes(table))).toBe(true);

    const extraRegisteredTables = registeredTables.filter((table) => !clientTables.includes(table));
    expect(extraRegisteredTables).toEqual(MOBILE_ADJACENT_MIGRATION_TABLES);
  });

  it('accounts for every Supabase Storage bucket used or declared here', () => {
    const registeredBuckets = PERSISTENCE_SURFACES
      .filter((surface) => surface.kind === 'supabase-storage-bucket')
      .map((surface) => surface.id.replace(/^supabase-storage-bucket:/, ''))
      .sort();

    expect(registeredBuckets).toEqual(bucketsInCodeAndMigrations());
  });

  it('does not invent local filesystem, SecureStore or bundle surfaces', () => {
    expect(sourceText('utils/shared/attachmentStorage.ts')).toContain('FileSystem.documentDirectory}attachments/');
    expect(sourceText('utils/shared/dataBackup.ts')).toContain('FileSystem.documentDirectory}${fileName}');
    expect(sourceText('utils/auth/pinAuth.ts')).toContain("const PIN_KEY = 'lifesort-app-pin-hash'");
    expect(sourceText('utils/auth/pinLockout.ts')).toContain("const LOCKOUT_KEY = 'lifesort-pin-lockout'");
    expect(fs.existsSync(path.join(REPO_ROOT, 'data', 'seedRecipes.ts'))).toBe(true);

    const specialSurfaces = PERSISTENCE_SURFACES.filter((surface) =>
      ['filesystem', 'secure-store', 'bundled-source'].includes(surface.kind),
    );
    for (const surface of specialSurfaces) {
      for (const evidence of surface.evidence) {
        expect(fs.existsSync(path.join(REPO_ROOT, evidence))).toBe(true);
      }
    }
  });
});

describe('APP-027 mixed-profile detection', () => {
  it('makes every known mixed physical surface explicit', () => {
    expect(mixedProfilePersistenceSurfaces().map((surface) => surface.id).sort()).toEqual([
      'async-storage:lifesort-cycle',
      'async-storage:lifesort-expenses',
      'async-storage:lifesort-food-v2',
      'async-storage:lifesort-trips',
      'async-storage:lifesort-warranties',
    ]);
  });

  it('detects profiles and sensitive data per surface', () => {
    expect(profilesForPersistenceSurface('async-storage:lifesort-food-v2')).toEqual(['A', 'D']);
    expect(profilesForPersistenceSurface('async-storage:lifesort-cycle')).toEqual(['B', 'D']);
    expect(persistenceSurfaceContainsProfileB('async-storage:lifesort-cycle')).toBe(true);
    expect(persistenceSurfaceContainsProfileB('async-storage:lifesort-food-v2')).toBe(false);
  });

  it('applies the strongest local-storage protection for surfaces containing Profile B', () => {
    for (const surface of PERSISTENCE_SURFACES) {
      const containsB = domainsForPersistenceSurface(surface.id).some((domain) => domain.profile === 'B');
      if (containsB) {
        expect(localStorageProtectionForSurface(surface.id)).toBe('encrypted-required');
        expect(localPlaintextPersistenceAllowedForSurface(surface.id)).toBe(false);
      }
    }
  });
});

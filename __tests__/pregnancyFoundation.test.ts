import { canStartNewPregnancy } from '@/core/pregnancy/startGate';
import { PREGNANCY_HEALTH_STORAGE } from '@/core/storage/pregnancyHealthStorageContract';
import { PREGNANCY_QUEUE_REQUIREMENT } from '@/core/sync/queuePersistence';
import { defaultModuleEnabled } from '@/core/modules/moduleEnablement';
import { moduleAccess } from '@/core/modules/moduleRegistry';

describe('APP-076 Pregnancy foundation boundary', () => {
  it('inherits health activation and remains non-public', () => {
    expect(defaultModuleEnabled('pregnancy')).toBe(false);
    expect(moduleAccess('pregnancy')).toMatchObject({ showInNavigation: false, canOpenModule: false, canCreate: false });
  });
  it('uses separate encrypted identities and an encrypted-only queue requirement', () => {
    expect(PREGNANCY_HEALTH_STORAGE).toMatchObject({ asyncStorageKey: 'lifesort-pregnancy', secureStoreKey: 'lifesort-pregnancy-health-key', aad: 'lifesort-pregnancy:v1', envelopeVersion: 1 });
    expect(PREGNANCY_QUEUE_REQUIREMENT).toMatchObject({ protection: 'encrypted-required', accountBound: true, datasetEpochRequired: true });
  });
  it('gates starts only, rather than encoding any data hiding/deletion decision', () => {
    expect(canStartNewPregnancy()).toBe(false);
    // A remote flag may restrict the registry declaration, never promote its
    // internal maturity into public creation access.
    expect(canStartNewPregnancy({ pregnancy: 'available' })).toBe(false);
    expect(canStartNewPregnancy({ pregnancy: 'maintenance' })).toBe(false);
  });
});

// --- Hostile-review additions: executable evidence for claims the structural tests above only assert as strings. ---
import fs from 'fs';
import path from 'path';

import { validateInput } from '@/core/sync/outboxValidation';
import { DATA_DOMAINS, PERSISTENCE_SURFACES, getDataDomain, persistenceSurfaceContainsProfileB } from '@/core/storage/dataProfileRegistry';
import type { HealthConsent, PregnancyAppointment, PregnancyEntry, PregnancySettings, PregnancySymptomLog } from '@/types/pregnancy';

describe('APP-076 Phase A isolation', () => {
  it('the existing plaintext outbox rejects the Pregnancy domain: it is Profile B on every surface', () => {
    const base = { entityType: 'pregnancy', entityId: '11111111-1111-4111-8111-111111111111', operation: 'upsert', payload: { method: 'lmp' } };
    expect(() => validateInput({ ...base, dataDomain: 'pregnancy.user-health' })).toThrow(/Invalid or unsupported outbox data/);
    expect(getDataDomain('pregnancy.user-health')?.profile).toBe('B');
    for (const id of getDataDomain('pregnancy.user-health')!.storageSurfaces) expect(persistenceSurfaceContainsProfileB(id)).toBe(true);
  });

  it('shares no ciphertext, key, AAD or surface with Cycle, and no other domain claims a Pregnancy surface', () => {
    expect(PREGNANCY_HEALTH_STORAGE.asyncStorageKey).not.toBe('lifesort-cycle');
    expect(PREGNANCY_HEALTH_STORAGE.secureStoreKey).not.toBe('lifesort-cycle-health-key');
    expect(PREGNANCY_HEALTH_STORAGE.aad).not.toBe('lifesort-cycle:v1');
    const cycleSurfaces = getDataDomain('cycle.user-health')!.storageSurfaces as readonly string[];
    expect(cycleSurfaces.some((id) => /pregnan/.test(id))).toBe(false);
    for (const surfaceId of ['async-storage:lifesort-pregnancy', 'secure-store:lifesort-pregnancy-health-key']) {
      expect(DATA_DOMAINS.filter((domain) => (domain.storageSurfaces as readonly string[]).includes(surfaceId)).map((domain) => domain.id)).toEqual(['pregnancy.user-health']);
      expect(PERSISTENCE_SURFACES.find((surface) => surface.id === surfaceId)?.lifecycle).toBe('implemented');
    }
  });

  it('the Phase A contract files read no gender, touch no storage and log nothing', () => {
    for (const file of ['core/pregnancy/startGate.ts', 'core/pregnancy/syncContract.ts', 'core/sync/queuePersistence.ts', 'core/storage/pregnancyHealthStorageContract.ts']) {
      expect(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')).not.toMatch(/gender|console\.|AsyncStorage|SecureStore/);
    }
  });
});

describe('APP-076 TypeScript contracts and SQL columns stay one contract (US-053)', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261013140000_app076_pregnancy_foundation.sql'), 'utf8');
  const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  /** Column names of one `create table public.<name> (...)`, ignoring table constraints. */
  const columns = (table: string): string[] => {
    const start = migration.indexOf(`create table public.${table} (`);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = migration.slice(start + `create table public.${table} (`.length, migration.indexOf('\n);', start));
    const items: string[] = []; let depth = 0; let current = '';
    for (const ch of body) {
      if (ch === '(') depth += 1; if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { items.push(current); current = ''; } else current += ch;
    }
    items.push(current);
    const initial = items.map((item) => item.trim()).filter((item) => item && !/^(constraint|foreign key|unique|check|primary key)\b/i.test(item)).map((item) => item.split(/\s+/)[0]);
    // APP-076 adds settings.revision in its corrective tail so the final
    // forward-only schema, rather than only the first CREATE TABLE body, is
    // what this parity test describes.
    if (table === 'pregnancy_settings' && migration.includes('alter table public.pregnancy_settings add column revision')) initial.push('revision');
    return initial.sort();
  };
  // `Record<keyof T, true>` makes the compiler reject a missing or extra field, so adding a TS field without a column (or vice versa) fails here.
  const entry: Record<keyof PregnancyEntry, true> = { id: true, method: true, lmpDate: true, conceptionDate: true, dueDateOverride: true, dueDateSource: true, endedAt: true, outcome: true, outcomeNotes: true, recoveryEndedAt: true, createdAt: true, revision: true, updatedAt: true, deletedAt: true };
  const log: Record<keyof PregnancySymptomLog, true> = { id: true, pregnancyId: true, date: true, symptoms: true, weightKg: true, bellyMeasurementCm: true, notes: true, revision: true, updatedAt: true, deletedAt: true };
  const appointment: Record<keyof PregnancyAppointment, true> = { id: true, pregnancyId: true, startsAt: true, timeZone: true, title: true, notes: true, completed: true, reminderEnabled: true, revision: true, updatedAt: true, deletedAt: true };
  const settings: Record<keyof PregnancySettings, true> = { recoveryDisplayDays: true, privacyMode: true, revision: true, updatedAt: true };
  const consent: Record<keyof HealthConsent, true> = { id: true, purpose: true, consentVersion: true, grantedAt: true, withdrawnAt: true };
  const expected = (fields: object) => [...Object.keys(fields).map(snake), 'user_id'].sort();

  it.each([
    ['pregnancies', entry], ['pregnancy_symptom_logs', log], ['pregnancy_appointments', appointment], ['pregnancy_settings', settings], ['health_consents', consent],
  ] as const)('%s has exactly the TypeScript fields plus the server-owned user_id', (table, fields) => {
    expect(columns(table)).toEqual(expected(fields));
  });
});

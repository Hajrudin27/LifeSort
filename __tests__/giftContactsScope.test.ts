/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { getDataDomain, PERSISTENCE_SURFACES } from '@/core/storage/dataProfileRegistry';
import { useGiftsStore } from '@/store/useGiftsStore';
import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

/**
 * APP-070 changes no persisted shape: not the Gift, not the store, not the backup format, not the
 * storage keys. The picked name is an ordinary personLabel the moment it reaches the form.
 */
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const NINE = ['id', 'personLabel', 'idea', 'occasionLabel', 'occasionDate', 'budget', 'purchasedOn', 'paid', 'createdAt'];

describe('backup (stays format 14)', () => {
  it('BACKUP_VERSION is still 14', () => {
    expect(BACKUP_VERSION).toBe(14);
  });

  it('an exported gift carries exactly its nine keys: no contact metadata can ride along', () => {
    useGiftsStore.setState({ gifts: [{ id: 'a', personLabel: 'Alice Smith', idea: 'Book', occasionLabel: 'Birthday', occasionDate: '2026-12-24', budget: 100 as never, purchasedOn: '2026-10-01', paid: 90 as never, createdAt: '2026-09-01T08:00:00.000Z' }] });
    const exported = useGiftsStore.getState().exportBackup();
    const keys = new Set(exported.gifts.flatMap((gift) => Object.keys(gift)));
    expect([...keys].sort()).toEqual([...NINE].sort());
  });

  it.each(['contactId', 'contactIdentifier', 'phone', 'phoneNumbers', 'email', 'emails', 'birthday', 'company', 'avatar', 'importedFromContacts'])(
    'a backup file whose gift carries "%s" is refused as a whole, so a restore never needs Contacts and never invents a field',
    (key) => {
      const file = {
        version: 14, exportedAt: '2026-10-12T09:30:00.000Z',
        data: { gifts: { gifts: [{ id: 'a', personLabel: 'Alice', idea: 'Book', createdAt: '2026-09-01T08:00:00.000Z', [key]: 'x' }] } },
      };
      const parsed = parseBackupFile(JSON.stringify(file));
      expect(parsed.ok).toBe(false);
    },
  );
});

describe('storage', () => {
  it('Gifts is still one Profile A, device-local logical domain on one surface', () => {
    const surfaces = PERSISTENCE_SURFACES.filter((surface) => (surface.containsDomains as readonly string[]).includes('gifts.gifts'));
    expect(surfaces.map((surface) => surface.id)).toEqual(['async-storage:lifesort-gifts']);
    expect(getDataDomain('gifts.gifts')).toMatchObject({ profile: 'A', expectsServerSync: false });
  });

  it('no persisted key, store, local migration or logout list mentions Contacts', () => {
    const files = ['core/storage/dataProfileRegistry.ts', 'core/storage/migrations/runtime.ts', 'features/localStores.ts', 'core/auth/clearLocalUserData.ts', 'utils/auth/clearLocalUserData.ts']
      .filter((file) => fs.existsSync(path.join(ROOT, file)));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
      const keys = [...text.matchAll(/lifesort-[a-z0-9-]*/g)].map((match) => match[0]);
      expect({ file, contactKeys: keys.filter((key) => /contact/i.test(key)) }).toEqual({ file, contactKeys: [] });
    }
    for (const store of fs.readdirSync(path.join(ROOT, 'store')).filter((file) => file.endsWith('.ts'))) {
      expect({ store, hit: /contacts/i.test(read(`store/${store}`).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')) }).toEqual({ store, hit: false });
    }
  });

  it('Gifts does not touch the server: nothing under supabase/ mentions gifts or contacts', () => {
    const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
    for (const file of walk('supabase')) {
      expect({ file, hit: /gift|contact/i.test(file) || /gift_|gifts\b|\bcontacts?_/i.test(read(file)) }).toEqual({ file, hit: false });
    }
  });
});

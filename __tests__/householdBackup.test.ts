import fs from 'fs';
import path from 'path';
import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

const oldTask = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'cleaning',
  title: 'Windows',
  frequency: 'quarterly',
  assignedTo: 'me',
  rotates: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('APP-061 backup v9', () => {
  it('migrates historical Home tasks with explicit null timezone', () => {
    const parsed = parseBackupFile(JSON.stringify({
      version: 8,
      data: { household: { tasks: [oldTask], shoppingItems: [], movingItems: [] } },
    }));
    expect(parsed).toMatchObject({ ok: true, version: 8, data: { household: {
      tasks: [{ ...oldTask, timeZone: null }],
    } } });
  });

  it('defaults pre-rotation tasks in historical formats but requires the fields in v9', () => {
    const { assignedTo: _a, rotates: _r, ...preRotation } = oldTask;
    const file = (version: number, task: object) => JSON.stringify({ version, data: { household: { tasks: [task] } } });
    expect(parseBackupFile(file(1, preRotation))).toMatchObject({ ok: true, data: { household: {
      tasks: [{ ...preRotation, assignedTo: 'me', rotates: false, timeZone: null }],
    } } });
    expect(parseBackupFile(file(9, { ...preRotation, timeZone: null }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('round-trips canonical v9 tasks and rejects malformed zones or sync metadata', () => {
    expect(BACKUP_VERSION).toBe(11);
    const canonical = { ...oldTask, timeZone: 'Europe/Copenhagen' };
    expect(parseBackupFile(JSON.stringify({
      version: 9,
      data: { household: { tasks: [canonical], shoppingItems: [], movingItems: [] } },
    }))).toMatchObject({ ok: true, data: { household: { tasks: [canonical] } } });
    for (const task of [{ ...canonical, timeZone: 'Bad/Zone' }, { ...canonical, revision: '7' }]) {
      expect(parseBackupFile(JSON.stringify({
        version: 9, data: { household: { tasks: [task], shoppingItems: [], movingItems: [] } },
      }))).toEqual({ ok: false, error: 'invalid_format' });
    }
  });

  it('exports an explicit content whitelist rather than the whole Household store', () => {
    const source = fs.readFileSync(path.join(__dirname, '../utils/shared/dataBackup.ts'), 'utf8');
    expect(source).toContain("key === 'household'");
    expect(source).not.toMatch(/data\[key\]\s*=\s*\{[^}]*taskSync/s);
  });
});

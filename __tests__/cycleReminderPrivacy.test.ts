import * as Notifications from 'expo-notifications';

import i18n from '@/localization/i18n';
import {
  CYCLE_REMINDER_ID,
  refreshCycleReminder,
  type CycleReminderInput,
} from '@/utils/cycle/cycleReminder';

type Request = { identifier: string; content: { title: string; body: string } };
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const permission = Notifications.getPermissionsAsync as jest.Mock;
const requestPermission = Notifications.requestPermissionsAsync as jest.Mock;
const os = new Map<string, Request>();
const futureDate = '2099-06-15';

const input = (overrides: Partial<CycleReminderInput> = {}): CycleReminderInput => ({
  accountId: 'account-a',
  isCurrentAccount: () => true,
  moduleEnabled: true,
  reminderEnabled: true,
  richNotificationCopyEnabled: false,
  predictedDate: futureDate,
  daysBefore: 1,
  ...overrides,
});

beforeEach(async () => {
  jest.clearAllMocks();
  os.clear();
  await i18n.changeLanguage('en');
  cancel.mockImplementation(async (id: string) => { os.delete(id); });
  schedule.mockImplementation(async (request: Request) => { os.set(request.identifier, request); return request.identifier; });
  permission.mockResolvedValue({ granted: true, status: 'granted' });
});

afterEach(() => {
  // APP-073 cleanup/refresh never turns an app update into a permission prompt.
  expect(requestPermission).not.toHaveBeenCalled();
});

describe('APP-073 Cycle lock-screen privacy', () => {
  it('uses generic copy by default; enabling a reminder is not consent for rich copy', async () => {
    await refreshCycleReminder(input());

    expect(os.get(CYCLE_REMINDER_ID)?.content).toEqual({
      title: 'LifeSort reminder', body: 'You have a reminder in LifeSort.',
    });
  });

  it.each([
    [1, 'Based on your logged cycles and cycle settings, it is estimated to start in 1 day.'],
    [2, 'Based on your logged cycles and cycle settings, it is estimated to start in 2 days.'],
    [3, 'Based on your logged cycles and cycle settings, it is estimated to start in 3 days.'],
  ])('uses rich copy only after explicit true consent and interpolates %i day(s)', async (daysBefore, expectedBody) => {
    await refreshCycleReminder(input({ richNotificationCopyEnabled: true, daysBefore }));
    expect(os.get(CYCLE_REMINDER_ID)?.content).toEqual({
      title: 'Your period is estimated to start soon',
      body: expectedBody,
    });
  });

  it.each([
    [1, 'Baseret på dine registrerede cyklusser og cyklusindstillinger estimeres den at starte om 1 dag.'],
    [3, 'Baseret på dine registrerede cyklusser og cyklusindstillinger estimeres den at starte om 3 dage.'],
  ])('uses Danish rich copy with the configured %i day(s) after explicit true consent', async (daysBefore, expectedBody) => {
    await i18n.changeLanguage('da');
    await refreshCycleReminder(input({ richNotificationCopyEnabled: true, daysBefore }));
    expect(os.get(CYCLE_REMINDER_ID)?.content).toEqual({
      title: 'Din menstruation estimeres at starte snart',
      body: expectedBody,
    });
  });

  it('keeps rich copy estimate-framed and free of fertility or ovulation guidance', async () => {
    await refreshCycleReminder(input({ richNotificationCopyEnabled: true }));
    const rich = os.get(CYCLE_REMINDER_ID)!.content;
    expect(`${rich.title} ${rich.body}`).toMatch(/estimated/i);
    expect(`${rich.title} ${rich.body}`).not.toMatch(/fertil|ovulation/i);
  });

  it('replaces an already scheduled rich request immediately when the user opts out', async () => {
    await refreshCycleReminder(input({ richNotificationCopyEnabled: true }));
    await refreshCycleReminder(input({ richNotificationCopyEnabled: false }));

    expect(os.get(CYCLE_REMINDER_ID)?.content).toEqual({
      title: 'LifeSort reminder', body: 'You have a reminder in LifeSort.',
    });
  });

  it('cancels legacy content without a prompt and leaves nothing when notification permission is absent', async () => {
    os.set(CYCLE_REMINDER_ID, { identifier: CYCLE_REMINDER_ID, content: { title: 'Your period is expected soon', body: 'Private history' } });
    permission.mockResolvedValue({ granted: false, status: 'undetermined' });

    await expect(refreshCycleReminder(input())).resolves.toMatchObject({ cancelled: true, scheduled: false, permission: 'not-granted' });
    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);
  });

  it('cancels but never recreates when the Cycle module is disabled, then honors retained preferences after re-enable', async () => {
    await refreshCycleReminder(input({ richNotificationCopyEnabled: true }));
    await refreshCycleReminder(input({ moduleEnabled: false, richNotificationCopyEnabled: true }));
    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);

    await refreshCycleReminder(input({ moduleEnabled: true, richNotificationCopyEnabled: true }));
    expect(os.get(CYCLE_REMINDER_ID)?.content.title).toBe('Your period is estimated to start soon');
  });

  it('cannot recreate account A content after account A became stale during a native schedule', async () => {
    let active = true;
    let release!: () => void;
    schedule.mockImplementationOnce(async (request: Request) => {
      os.set(request.identifier, request);
      await new Promise<void>((resolve) => { release = resolve; });
      return request.identifier;
    });

    const pending = refreshCycleReminder(input({ richNotificationCopyEnabled: true, isCurrentAccount: () => active }));
    for (let i = 0; i < 20 && !release; i += 1) await Promise.resolve();
    active = false;
    release();
    await pending;

    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);
  });

  it.each([
    ['en', /period|cycle|pregnancy|symptom|condition|reproductive|predict/i],
    ['da', /menstruation|cyklus|gravid|symptom|tilstand|forvent/i],
  ])('generic %s copy contains no reproductive detail', async (language, forbidden) => {
    await i18n.changeLanguage(language);
    await refreshCycleReminder(input());
    const generic = os.get(CYCLE_REMINDER_ID)!.content;
    expect(`${generic.title} ${generic.body}`).not.toMatch(forbidden);
  });
});

describe('APP-073 review hardening: strict consent, gating, and serialization', () => {
  const asBoolean = (value: unknown) => value as boolean;

  it.each([['string true', 'true'], ['one', 1], ['object', {}], ['null', null], ['undefined', undefined]])(
    'treats %s as no consent',
    async (_name, value) => {
      await refreshCycleReminder(input({ richNotificationCopyEnabled: asBoolean(value) }));
      expect(os.get(CYCLE_REMINDER_ID)?.content.title).toBe('LifeSort reminder');
    },
  );

  it('with reminders off it cancels a legacy request and schedules nothing', async () => {
    os.set(CYCLE_REMINDER_ID, { identifier: CYCLE_REMINDER_ID, content: { title: 'Your period is expected soon', body: 'x' } });
    await refreshCycleReminder(input({ reminderEnabled: false, richNotificationCopyEnabled: true }));
    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('logged-out cleanup cancels, never reads permission, never schedules', async () => {
    os.set(CYCLE_REMINDER_ID, { identifier: CYCLE_REMINDER_ID, content: { title: 'Your period is expected soon', body: 'x' } });
    await refreshCycleReminder(input({ accountId: null, isCurrentAccount: () => true }));
    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);
    expect(permission).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a stale account at the start neither cancels nor schedules, so it cannot erase the next account', async () => {
    os.set(CYCLE_REMINDER_ID, { identifier: CYCLE_REMINDER_ID, content: { title: 'LifeSort reminder', body: 'b' } });
    await refreshCycleReminder(input({ isCurrentAccount: () => false }));
    expect(cancel).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(os.has(CYCLE_REMINDER_ID)).toBe(true);
  });

  it('does not schedule when the account goes stale while permission is being read', async () => {
    let active = true;
    permission.mockImplementationOnce(async () => { active = false; return { granted: true, status: 'granted' }; });
    await refreshCycleReminder(input({ isCurrentAccount: () => active }));
    expect(schedule).not.toHaveBeenCalled();
    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);
  });

  it('serializes overlapping refreshes: a slow older rich schedule cannot land after a newer generic one', async () => {
    let release!: () => void;
    schedule.mockImplementationOnce(async (request: Request) => {
      await new Promise<void>((resolve) => { release = resolve; });
      os.set(request.identifier, request);
      return request.identifier;
    });

    const older = refreshCycleReminder(input({ richNotificationCopyEnabled: true }));
    for (let i = 0; i < 20 && !release; i += 1) await Promise.resolve();
    const newer = refreshCycleReminder(input({ richNotificationCopyEnabled: false }));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    release();
    await Promise.all([older, newer]);

    expect(os.get(CYCLE_REMINDER_ID)?.content.title).toBe('LifeSort reminder');
  });

  it('a newer cancellation wins over an older in-flight schedule', async () => {
    let release!: () => void;
    schedule.mockImplementationOnce(async (request: Request) => {
      await new Promise<void>((resolve) => { release = resolve; });
      os.set(request.identifier, request);
      return request.identifier;
    });

    const older = refreshCycleReminder(input({ richNotificationCopyEnabled: true }));
    for (let i = 0; i < 20 && !release; i += 1) await Promise.resolve();
    const newer = refreshCycleReminder(input({ moduleEnabled: false }));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    release();
    await Promise.all([older, newer]);

    expect(os.has(CYCLE_REMINDER_ID)).toBe(false);
  });
});

describe('APP-073 root lifecycle wiring (structural)', () => {
  const layout = require('fs').readFileSync(require('path').join(__dirname, '..', 'app/_layout.tsx'), 'utf8') as string;
  const effect = layout.match(/useEffect\(\(\) => \{\n\s+if \(!cycleReminderReady\) return;[\s\S]*?\n  \}, \[[\s\S]*?\]\);/)?.[0] ?? '';

  it('only becomes ready after both protected Cycle and module choice have hydrated, with no network call', () => {
    const gate = layout.match(/useEffect\(\(\) => \{\n\s+let active = true;\n\s+void Promise\.all\(\[[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
    expect(gate).toMatch(/whenStoreHydrated\(useCycleStore\)/);
    expect(gate).toMatch(/whenStoreHydrated\(useEnabledModulesStore\)/);
    expect(gate).not.toMatch(/fetch/i);
  });

  it('refreshes from canonical module enablement, the live account and strict inputs, and never requests permission', () => {
    expect(effect).not.toBe('');
    expect(effect).toMatch(/moduleEnabled: cycleModuleEnabled/);
    expect(layout).toMatch(/const cycleModuleEnabled = useModuleEnabled\('cycle'\)/);
    expect(effect).toMatch(/useAuthStore\.getState\(\)\.session/);
    expect(effect).toMatch(/\.catch\(\(\) => undefined\)/);
    expect(effect).toMatch(/\[\s*cycleReminderReady,\s*session\?\.user\.id,\s*cycleModuleEnabled,\s*cycleReminderEnabled,\s*cycleReminderDaysBefore,\s*richCycleNotificationCopyEnabled,/);
    expect(layout).not.toMatch(/requestPermissionsAsync/);
  });
});

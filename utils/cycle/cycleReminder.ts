import * as Notifications from 'expo-notifications';

import i18n from '@/localization/i18n';

/** Stable across releases so APP-073 can remove the sensitive legacy request. */
export const CYCLE_REMINDER_ID = 'cycle-period-reminder';

export type CycleReminderInput = {
  /** Null is the logged-out startup cleanup case: cancel, never schedule. */
  accountId: string | null;
  isCurrentAccount: () => boolean;
  moduleEnabled: boolean;
  reminderEnabled: boolean;
  richNotificationCopyEnabled: boolean;
  predictedDate: string | null;
  daysBefore: number;
};

export type CycleReminderRefresh = {
  cancelled: boolean;
  scheduled: boolean;
  permission: 'granted' | 'not-granted' | 'unknown';
  failures: number;
};

let lane: Promise<unknown> = Promise.resolve();

/** Keep a late refresh from re-creating a reminder after a later cancellation. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = lane.then(task, task);
  lane = run.catch(() => undefined);
  return run;
}

function triggerDate(predictedDate: string, daysBefore: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(predictedDate) || !Number.isInteger(daysBefore) || daysBefore < 0) return null;
  const [year, month, day] = predictedDate.split('-').map(Number);
  const date = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  date.setDate(date.getDate() - daysBefore);
  return date.getTime() > Date.now() ? date : null;
}

function canPresent(permission: Notifications.NotificationPermissionsStatus): boolean {
  return permission.granted === true
    || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

function content(rich: boolean) {
  return rich
    ? { title: i18n.t('cycle.reminderRichNotifTitle'), body: i18n.t('cycle.reminderRichNotifBody') }
    : { title: i18n.t('cycle.reminderGenericNotifTitle'), body: i18n.t('cycle.reminderGenericNotifBody') };
}

/**
 * APP-073: replace the one historical Cycle request only after encrypted Cycle
 * state has hydrated. This never prompts, has no health payload, and serializes
 * replacement with user setting changes and account lifecycle cleanup.
 */
export function refreshCycleReminder(input: CycleReminderInput): Promise<CycleReminderRefresh> {
  return serialized(async () => {
    const result: CycleReminderRefresh = { cancelled: false, scheduled: false, permission: 'unknown', failures: 0 };

    // A stale account must not cancel the next account's freshly scheduled reminder.
    if (input.accountId !== null && !input.isCurrentAccount()) return result;

    try {
      await Notifications.cancelScheduledNotificationAsync(CYCLE_REMINDER_ID);
      result.cancelled = true;
    } catch {
      result.failures += 1;
    }

    // A cancellation is the complete, safe result for logged-out, disabled, or invalid states.
    if (input.accountId === null || !input.isCurrentAccount() || !input.moduleEnabled || !input.reminderEnabled
      || input.predictedDate === null) return result;

    const date = triggerDate(input.predictedDate, input.daysBefore);
    if (date === null) return result;

    try {
      const permission = await Notifications.getPermissionsAsync();
      result.permission = canPresent(permission) ? 'granted' : 'not-granted';
    } catch {
      result.failures += 1;
      return result;
    }

    if (result.permission !== 'granted' || !input.isCurrentAccount()) return result;

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: CYCLE_REMINDER_ID,
        // Strict: a persisted or fetched non-boolean must never select rich copy.
        content: content(input.richNotificationCopyEnabled === true),
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });
      // Logout or an account switch during this await must not leave account A's request behind.
      if (!input.isCurrentAccount()) {
        await Notifications.cancelScheduledNotificationAsync(CYCLE_REMINDER_ID).catch(() => undefined);
        return result;
      }
      result.scheduled = true;
    } catch {
      result.failures += 1;
    }
    return result;
  });
}

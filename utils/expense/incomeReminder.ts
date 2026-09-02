import * as Notifications from 'expo-notifications';

import { getLastWeekdayOfMonth } from '@/utils/shared/lastWeekdayOfMonth';

const REMINDER_IDENTIFIER = 'income-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function scheduleIncomeReminder(title: string, body: string) {
  await Notifications.requestPermissionsAsync();

  // Ryd en evt. tidligere planlagt påmindelse, så vi aldrig har to i kø
  await Notifications.cancelScheduledNotificationAsync(REMINDER_IDENTIFIER);

  const now = new Date();
  let target = getLastWeekdayOfMonth(now.getFullYear(), now.getMonth());
  target.setHours(9, 0, 0, 0);

  // Er den sidste hverdag i denne måned allerede overstået, planlæg til næste måned i stedet
  if (target.getTime() <= now.getTime()) {
    target = getLastWeekdayOfMonth(now.getFullYear(), now.getMonth() + 1);
    target.setHours(9, 0, 0, 0);
  }

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_IDENTIFIER,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target },
  });
}
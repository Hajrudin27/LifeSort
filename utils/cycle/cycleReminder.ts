import * as Notifications from 'expo-notifications';

const REMINDER_ID = 'cycle-period-reminder';

export async function scheduleCycleReminder(predictedDate: string, daysBefore: number, title: string, body: string) {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});

  const triggerDate = new Date(`${predictedDate}T09:00:00`);
  triggerDate.setDate(triggerDate.getDate() - daysBefore);

  if (triggerDate.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
  });
}

export async function cancelCycleReminder() {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});
}
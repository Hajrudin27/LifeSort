import i18n from "@/localization/i18n";
import * as Notifications from "expo-notifications";

function reminderId(tripId: string) {
  return `trip-packing-${tripId}`;
}

export async function scheduleTripPackingReminder(
  tripId: string,
  name: string,
  startDate: string,
) {
  await Notifications.requestPermissionsAsync();
  await Notifications.cancelScheduledNotificationAsync(reminderId(tripId));

  const start = new Date(startDate);
  const reminderDate = new Date(start);
  reminderDate.setDate(reminderDate.getDate() - 2);
  reminderDate.setHours(9, 0, 0, 0);

  if (reminderDate.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: reminderId(tripId),
    content: {
      title: i18n.t("travel.packingReminderTitle", { name }),
      body: i18n.t("travel.packingReminderBody"),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
    },
  });
}

export async function cancelTripPackingReminder(tripId: string) {
  await Notifications.cancelScheduledNotificationAsync(reminderId(tripId));
}

import i18n from "@/localization/i18n";
import * as Notifications from "expo-notifications";

const REMINDER_OFFSETS = [30, 7, 1]; // dage før udløb

function reminderId(warrantyId: string, daysBefore: number) {
  return `warranty-${warrantyId}-${daysBefore}`;
}

export async function scheduleWarrantyReminder(
  warrantyId: string,
  name: string,
  expiryDate: string,
) {
  await Notifications.requestPermissionsAsync();

  // Ryd alle tidligere planlagte påmindelser for denne garanti, uanset hvilke offsets de havde
  await Promise.all(
    REMINDER_OFFSETS.map((offset) =>
      Notifications.cancelScheduledNotificationAsync(
        reminderId(warrantyId, offset),
      ),
    ),
  );

  const expiry = new Date(expiryDate);

  for (const daysBefore of REMINDER_OFFSETS) {
    const reminderDate = new Date(expiry);
    reminderDate.setDate(reminderDate.getDate() - daysBefore);
    reminderDate.setHours(9, 0, 0, 0);

    if (reminderDate.getTime() <= Date.now()) continue; // spring allerede-passerede tidspunkter over

    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(warrantyId, daysBefore),
      content: {
        title: i18n.t("warranties.reminderTitle", { name }),
        body: i18n.t("warranties.reminderBody", { days: daysBefore }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
      },
    });
  }
}

export async function cancelWarrantyReminder(warrantyId: string) {
  await Promise.all(
    REMINDER_OFFSETS.map((offset) =>
      Notifications.cancelScheduledNotificationAsync(
        reminderId(warrantyId, offset),
      ),
    ),
  );
}

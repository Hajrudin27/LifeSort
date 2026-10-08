import { addDaysIso, startOfIsoWeek, todayIso } from '@/utils/shared/localDate';

/**
 * Er datoen i den ISO-uge (mandag–søndag) som i dag ligger i? Bruges af Home til opgaver; vaner
 * har deres egen ugedefinition i features/habits/domain, som læser den samme `startOfIsoWeek`.
 */
export function isDateInCurrentWeek(dateKey: string): boolean {
  const monday = startOfIsoWeek(todayIso());
  return dateKey >= monday && dateKey <= addDaysIso(monday, 6);
}

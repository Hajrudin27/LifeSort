import { Platform } from 'react-native';

import { TodoItem } from '@/types/life';

function dateRangeForTodo(dueDate: string) {
  const startDate = new Date(`${dueDate}T09:00:00`);
  const endDate = new Date(startDate);
  endDate.setHours(startDate.getHours() + 1);
  return { startDate, endDate };
}

export async function addTodoToCalendar(todo: TodoItem) {
  if (!todo.dueDate) {
    return { ok: false as const, reason: 'missing-date' as const };
  }

  try {
    const Calendar = await import('expo-calendar');
    const permission = await Calendar.requestCalendarPermissions(true);

    if (!permission.granted) {
      return { ok: false as const, reason: 'permission-denied' as const };
    }

    const calendar =
      Platform.OS === 'ios'
        ? Calendar.getDefaultCalendarSync()
        : (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).find((item) => item.allowsModifications);

    if (!calendar) {
      return { ok: false as const, reason: 'no-calendar' as const };
    }

    const { startDate, endDate } = dateRangeForTodo(todo.dueDate);
    await calendar.addEventWithForm({
      title: todo.title,
      notes: todo.description,
      startDate,
      endDate,
      allDay: true,
      alarms: [{ relativeOffset: -60 }],
    });

    return { ok: true as const };
  } catch (error) {
    if (__DEV__) console.warn('[calendar] todo sync:', error);
    return { ok: false as const, reason: 'unavailable' as const };
  }
}

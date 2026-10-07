import type { HouseholdTask, TaskFrequency } from '@/types/household';
import { addDaysIso, daysBetweenIso, parseCalendarDate, toLocalIsoDate } from '@/utils/shared/localDate';
import { deviceIanaTimeZone, isValidIanaTimeZone } from '@/utils/shared/timeZone';

export class HouseholdTaskScheduleError extends Error {
  constructor(readonly code: 'invalid_date' | 'invalid_time_zone' | 'time_zone_unavailable') {
    super(code);
    this.name = 'HouseholdTaskScheduleError';
  }
}

const pad = (value: number) => String(value).padStart(2, '0');
const monthLength = (year: number, month: number) => {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return Number(addDaysIso(`${next.year}-${pad(next.month)}-01`, -1).slice(8));
};

export function isValidTimeZone(value: unknown): value is string {
  return isValidIanaTimeZone(value);
}

export function resolvedDeviceTimeZone(): string {
  const zone = deviceIanaTimeZone();
  if (zone === null) throw new HouseholdTaskScheduleError('time_zone_unavailable');
  return zone;
}

function calendarDateInZone(instant: Date, timeZone: string): string {
  if (!Number.isFinite(instant.getTime())) throw new HouseholdTaskScheduleError('invalid_date');
  if (!isValidTimeZone(timeZone)) throw new HouseholdTaskScheduleError('invalid_time_zone');
  try {
    const field = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    const numeric = (formatter: Intl.DateTimeFormat) => {
      const text = formatter.format(instant).replace(/[‎‏؜\s]/g, '');
      if (!/^\d+$/.test(text)) throw new HouseholdTaskScheduleError('time_zone_unavailable');
      return Number(text);
    };
    const year = numeric(field({ year: 'numeric' }));
    const month = numeric(field({ month: '2-digit' }));
    const day = numeric(field({ day: '2-digit' }));
    const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
    if (!parseCalendarDate(date)) throw new HouseholdTaskScheduleError('time_zone_unavailable');
    return date;
  } catch (error) {
    if (error instanceof HouseholdTaskScheduleError) throw error;
    throw new HouseholdTaskScheduleError('time_zone_unavailable');
  }
}

/** Calendar date for a task. Null deliberately means the device's local calendar. */
export function calendarDateForTask(
  task: Pick<HouseholdTask, 'timeZone'>,
  instant = new Date(),
  legacyDeviceTimeZone?: string,
): string {
  if (task.timeZone === null && legacyDeviceTimeZone === undefined) {
    if (!Number.isFinite(instant.getTime())) throw new HouseholdTaskScheduleError('invalid_date');
    return toLocalIsoDate(instant);
  }
  return calendarDateInZone(instant, task.timeZone ?? legacyDeviceTimeZone!);
}

export function nextHouseholdTaskDueOn(lastDone: string, frequency: TaskFrequency): string {
  const date = parseCalendarDate(lastDone);
  if (!date) throw new HouseholdTaskScheduleError('invalid_date');
  if (frequency === 'weekly') return addDaysIso(lastDone, 7);
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const index = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(Math.min(date.day, monthLength(year, month)))}`;
}

export function dueOnForHouseholdTask(task: HouseholdTask): string | null {
  return task.lastDone ? nextHouseholdTaskDueOn(task.lastDone, task.frequency) : null;
}

export function daysUntilDue(task: HouseholdTask, instant = new Date(), legacyDeviceTimeZone?: string): number {
  const today = calendarDateForTask(task, instant, legacyDeviceTimeZone);
  const due = dueOnForHouseholdTask(task);
  return due === null ? 0 : daysBetweenIso(today, due);
}

export function householdTaskReminderCandidate(task: HouseholdTask) {
  return Object.freeze({
    taskId: task.id,
    dueOn: dueOnForHouseholdTask(task) ?? calendarDateForTask(task),
    timeZone: task.timeZone,
    category: 'home-task' as const,
  });
}

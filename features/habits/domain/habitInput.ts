import { ISO_WEEKDAYS, schedulesEqual } from '@/core/habits/persistedHabit';
export { schedulesEqual };
import type { HabitSchedule, IsoWeekday } from '@/types/life';

/**
 * APP-064 — the schedule chooser as plain data. The form keeps what the user picked and typed;
 * these functions turn it into a canonical schedule, or `null` when it is not valid yet. A
 * `null` result is how the form blocks saving BEFORE anything reaches the store.
 */
export type ScheduleChoice = 'everyDay' | 'selectedDays' | 'weekly' | 'open';

export interface ScheduleForm {
  choice: ScheduleChoice;
  /** The weekdays ticked under "selected days". Kept while the user looks at other choices. */
  days: IsoWeekday[];
  /** What was typed for "N times a week". */
  weeklyText: string;
}

export const EVERY_DAY: HabitSchedule = Object.freeze({ kind: 'weekdays', days: Object.freeze([...ISO_WEEKDAYS]) }) as unknown as HabitSchedule;

/** New habits start as "every day": the most common intent and the least to explain. */
export const DEFAULT_SCHEDULE_FORM: ScheduleForm = Object.freeze({ choice: 'everyDay', days: [], weeklyText: '' }) as ScheduleForm;

export const isEveryDay = (schedule: HabitSchedule): boolean => schedulesEqual(schedule, EVERY_DAY);

/** "3" → 3. A single digit 1–7, nothing else: no sign, decimal, space inside, or zero. */
export function parseWeeklyTarget(text: string): number | null {
  const match = /^[1-7]$/.exec(text.trim());
  return match ? Number(match[0]) : null;
}

export function toggleDay(days: readonly IsoWeekday[], day: IsoWeekday): IsoWeekday[] {
  const next = days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day];
  return next.sort((a, b) => a - b);
}

export function scheduleFromForm(form: ScheduleForm): HabitSchedule | null {
  switch (form.choice) {
    case 'everyDay':
      return { kind: 'weekdays', days: [...ISO_WEEKDAYS] };
    case 'selectedDays':
      return form.days.length > 0 ? { kind: 'weekdays', days: [...form.days].sort((a, b) => a - b) } : null;
    case 'weekly': {
      const target = parseWeeklyTarget(form.weeklyText);
      return target === null ? null : { kind: 'weekly', target };
    }
    case 'open':
      return { kind: 'open' };
  }
}

/** The form that reproduces a stored schedule (for editing). */
export function formFromSchedule(schedule: HabitSchedule): ScheduleForm {
  if (schedule.kind === 'open') return { choice: 'open', days: [], weeklyText: '' };
  if (schedule.kind === 'weekly') return { choice: 'weekly', days: [], weeklyText: String(schedule.target) };
  if (isEveryDay(schedule)) return { choice: 'everyDay', days: [], weeklyText: '' };
  return { choice: 'selectedDays', days: [...schedule.days], weeklyText: '' };
}

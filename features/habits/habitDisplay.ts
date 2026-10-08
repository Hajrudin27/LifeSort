import type { TFunction } from 'i18next';

import { isEveryDay } from '@/features/habits/domain/habitInput';
import {
  habitDayStatus,
  habitWeekFacts,
  hasEntryOn,
  isScheduledOn,
  pendingSchedulePeriod,
  scheduleForDisplay,
  scheduleOn,
  type HabitDayStatus,
} from '@/features/habits/domain/habitStatus';
import type { Habit, HabitSchedule, IsoWeekday } from '@/types/life';

/**
 * Words for what the habit domain decides. Nothing here decides anything: a status is
 * computed by features/habits/domain, and these functions only name it. Copy stays neutral —
 * a day that was scheduled and has no entry is "Not completed", never a failure, a broken
 * chain or a bad day — and says "kept" for a quit habit, because an entry means the same
 * thing in both directions: the commitment was kept.
 */
export const localeFor = (language: string) => (language.startsWith('da') ? 'da-DK' : 'en-US');

/** Civil date -> text. Formatted in UTC from the date's own numbers, so the device timezone cannot move the day. */
function formatDate(date: string, language: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split('-').map(Number);
  try {
    const instant = new Date(0);
    instant.setUTCFullYear(year, month - 1, day);
    return new Intl.DateTimeFormat(localeFor(language), { ...options, timeZone: 'UTC' }).format(instant);
  } catch {
    return date;
  }
}

export const longDateText = (date: string, language: string) =>
  formatDate(date, language, { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDateText = (date: string, language: string) =>
  formatDate(date, language, { day: 'numeric', month: 'short' });
/** 'YYYY-MM' -> "October 2026". */
export const monthText = (monthKey: string, language: string) =>
  formatDate(`${monthKey}-01`, language, { month: 'long', year: 'numeric' });

export type WeekdayStyle = 'long' | 'short' | 'narrow';
export const weekdayText = (day: IsoWeekday, style: WeekdayStyle, t: TFunction): string => t(`habits.weekday.${style}.${day}`);

export function scheduleSummary(schedule: HabitSchedule, t: TFunction): string {
  if (schedule.kind === 'open') return t('habits.schedule.open');
  if (schedule.kind === 'weekly') return t('habits.schedule.weeklySummary', { count: schedule.target });
  if (isEveryDay(schedule)) return t('habits.schedule.everyDay');
  return schedule.days.map((day) => weekdayText(day, 'short', t)).join(', ');
}

/** The schedule line plus, when a change is waiting for Monday, when it starts. */
export function scheduleLines(habit: Habit, today: string, t: TFunction, language: string): string[] {
  const lines = [scheduleSummary(scheduleForDisplay(habit, today), t)];
  const pending = pendingSchedulePeriod(habit, today);
  if (pending) {
    lines.push(t('habits.schedule.pending', {
      date: shortDateText(pending.effectiveFrom, language), schedule: scheduleSummary(pending.schedule, t),
    }));
  }
  return lines;
}

export function statusWord(status: HabitDayStatus, direction: Habit['direction'], t: TFunction): string {
  switch (status) {
    case 'completed': return t(`habits.status.completed.${direction}`);
    case 'missed': return t(`habits.status.missed.${direction}`);
    case 'pending': return t('habits.status.pending');
    case 'optional': return t('habits.status.optional');
    case 'future': return t('habits.status.future');
    case 'before-start': return t('habits.status.beforeStart');
  }
}

/**
 * Short glyph per status: a shape the eye can tell apart without colour. Mirrored by the legend.
 * Only a day before the start date has none; it is faded and has no border instead.
 */
export const STATUS_GLYPH: Record<HabitDayStatus, string> = {
  completed: '✓',
  missed: '–',
  pending: '○',
  optional: '·',
  future: '',
  'before-start': '',
};

/** Today, as one line for lists and the detail header. */
export function todayText(habit: Habit, today: string, t: TFunction, language: string): string {
  const status = habitDayStatus(habit, today, today);
  if (status === 'before-start') return t('habits.today.notStarted', { date: shortDateText(habit.startDate, language) });
  if (status === 'completed') return t(`habits.today.completed.${habit.direction}`);
  if (status === 'pending') return t('habits.today.pending');
  return scheduleOn(habit, today)?.kind === 'weekdays' ? t('habits.today.notScheduled') : t('habits.today.noEntry');
}

/** "2 of 4 scheduled days this week", "1 of 3 this week", "2 entries this week". Never a verdict. */
export function weekFactsText(habit: Habit, today: string, t: TFunction, language: string): string {
  const facts = habitWeekFacts(habit, today);
  if (!facts) return t('habits.week.notStarted', { date: shortDateText(habit.startDate, language) });
  if (facts.kind === 'weekly') return t('habits.week.weekly', { done: facts.completed, target: facts.target });
  if (facts.kind === 'open') return t('habits.week.open', { count: facts.completed });
  const base = t('habits.week.weekdays', { done: facts.completedScheduled, total: facts.scheduled });
  return facts.completedOther > 0 ? `${base} · ${t('habits.week.weekdaysExtra', { count: facts.completedOther })}` : base;
}

/**
 * The whole label a screen reader reads for one real date, e.g.
 * "Wednesday 7 October, scheduled, completed". Nothing is left to colour or position.
 */
export function dayAccessibilityLabel(habit: Habit, date: string, today: string, t: TFunction, language: string): string {
  const status = habitDayStatus(habit, date, today);
  const parts = [longDateText(date, language)];
  if (status !== 'before-start' && status !== 'future') {
    const schedule = scheduleOn(habit, date);
    if (schedule?.kind === 'weekdays') parts.push(isScheduledOn(habit, date) ? t('habits.a11y.scheduled') : t('habits.a11y.notScheduled'));
    else parts.push(t('habits.a11y.noFixedDay'));
  }
  parts.push(statusWord(status, habit.direction, t).toLocaleLowerCase(localeFor(language)));
  // A future date can only be completed by data that arrived from elsewhere; say so, and that it can be cleared.
  if (status === 'future' && hasEntryOn(habit, date)) parts.push(t('habits.a11y.completedEntry'));
  return parts.join(', ');
}

/** Whether the user can change this date, and to what, per the domain's own rules. */
export type DayAction = 'mark' | 'clear' | 'none';

export function dayAction(habit: Habit, date: string, today: string): DayAction {
  if (hasEntryOn(habit, date)) return 'clear';
  return date <= today && date >= habit.startDate ? 'mark' : 'none';
}

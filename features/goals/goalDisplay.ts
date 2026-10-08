import type { TFunction } from 'i18next';

import { hundredthsToText, minutesToParts } from '@/features/goals/domain/goalInput';
import type { LifeGoal } from '@/types/life';

/** Decimal separator for typed and shown amounts. Display only: storage is integer hundredths. */
export const decimalSeparator = (language: string): ',' | '.' => (language.startsWith('da') ? ',' : '.');

export function durationText(minutes: number, t: TFunction): string {
  const { hours, minutes: rest } = minutesToParts(minutes);
  if (hours > 0 && rest > 0) return t('lifeGoals.value.hoursMinutes', { hours, minutes: rest });
  if (hours > 0) return t('lifeGoals.value.hours', { hours });
  return t('lifeGoals.value.minutes', { minutes: rest });
}

/** "7 / 12", "25.5 / 100 km", "1 h 30 min / 100 h", or the binary status. The real numbers, even above target. */
export function goalValueText(goal: LifeGoal, t: TFunction, language: string): string {
  switch (goal.type) {
    case 'binary':
      return goal.completed ? t('lifeGoals.binary.done') : t('lifeGoals.binary.open');
    case 'count':
      return t('lifeGoals.value.count', { current: goal.current, target: goal.target });
    case 'amount': {
      const separator = decimalSeparator(language);
      return t('lifeGoals.value.amount', {
        current: hundredthsToText(goal.current, separator),
        target: hundredthsToText(goal.target, separator),
        unit: goal.unit,
      });
    }
    case 'duration':
      return t('lifeGoals.value.count', { current: durationText(goal.current, t), target: durationText(goal.target, t) });
  }
}

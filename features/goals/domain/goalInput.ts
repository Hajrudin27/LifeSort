import { isGoalUnit, isGoalValue, MAX_GOAL_VALUE, type NewGoalInput } from './goal';

/**
 * Parsing and formatting of what the user types, to and from the canonical integers.
 * Everything is digit-string work: no value is ever produced by a float multiplication,
 * so nothing that reaches storage can carry a floating-point artefact.
 */
export type NumberInputResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly code: 'input_invalid' | 'input_too_large' };

const invalid = { ok: false, code: 'input_invalid' } as const;
const tooLarge = { ok: false, code: 'input_too_large' } as const;
const finish = (digits: string): NumberInputResult => {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed.length > String(MAX_GOAL_VALUE).length) return tooLarge;
  const value = Number(trimmed);
  return isGoalValue(value) ? { ok: true, value } : tooLarge;
};

/** "12" → 12. ASCII digits only: no sign, separator, exponent or grouping. */
export function parseCountInput(text: string): NumberInputResult {
  const match = /^\d+$/.exec(text.trim());
  return match ? finish(match[0]) : invalid;
}

/** "12", "12,5", "12.50", "0.01" → integer hundredths. One separator, at most two decimals. */
export function parseAmountInput(text: string): NumberInputResult {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  return match ? finish(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`) : invalid;
}

/** Hours and minutes as typed → integer minutes. Minutes must be 0–59; empty fields mean 0. */
export function parseDurationInput(hours: string, minutes: string): NumberInputResult {
  const h = hours.trim() === '' ? { ok: true, value: 0 } as const : parseCountInput(hours);
  const m = minutes.trim() === '' ? { ok: true, value: 0 } as const : parseCountInput(minutes);
  if (!h.ok || !m.ok) return !h.ok ? h : m;
  if (m.value > 59) return invalid;
  return finish(String(h.value * 60 + m.value));
}

/** 1250 → "12.50", 1200 → "12" with the given separator. Exact: built from the digits. */
export function hundredthsToText(value: number, separator: ',' | '.'): string {
  const digits = String(value).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  if (fraction === '00') return whole;
  return `${whole}${separator}${fraction.endsWith('0') ? fraction.slice(0, 1) : fraction}`;
}

export function minutesToParts(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

// ---------- the goal form: typed text in, canonical NewGoalInput or localized error keys out ----

export type NumericGoalType = 'count' | 'amount' | 'duration';
/** What the user has typed for one value. Count and amount use `text`; duration uses hours and minutes. */
export interface GoalValueText { text: string; hours: string; minutes: string }
export const EMPTY_VALUE_TEXT: GoalValueText = Object.freeze({ text: '', hours: '', minutes: '' });

export const isBlankValue = (type: NumericGoalType, value: GoalValueText) =>
  type === 'duration' ? value.hours.trim() === '' && value.minutes.trim() === '' : value.text.trim() === '';

export function parseValueText(type: NumericGoalType, value: GoalValueText): NumberInputResult {
  if (type === 'count') return parseCountInput(value.text);
  if (type === 'amount') return parseAmountInput(value.text);
  return parseDurationInput(value.hours, value.minutes);
}

/** Editable text for a stored value, re-parseable by `parseValueText`. */
export function valueTextFrom(type: NumericGoalType, value: number, separator: ',' | '.'): GoalValueText {
  if (type === 'count') return { text: String(value), hours: '', minutes: '' };
  if (type === 'amount') return { text: hundredthsToText(value, separator), hours: '', minutes: '' };
  const parts = minutesToParts(value);
  return { text: '', hours: String(parts.hours), minutes: String(parts.minutes) };
}

export type GoalFormErrorKey =
  | 'title' | 'unit' | 'tooLarge'
  | 'targetCount' | 'targetAmount' | 'targetDuration'
  | 'currentCount' | 'currentAmount' | 'currentDuration';
const cap = (type: NumericGoalType) => (type === 'count' ? 'Count' : type === 'amount' ? 'Amount' : 'Duration') as 'Count' | 'Amount' | 'Duration';

/** A required value above zero, or an error key to show next to the field. */
export function parseTarget(type: NumericGoalType, value: GoalValueText): { value: number } | { error: GoalFormErrorKey } {
  const parsed = parseValueText(type, value);
  if (!parsed.ok) return { error: parsed.code === 'input_too_large' ? 'tooLarge' : (`target${cap(type)}` as GoalFormErrorKey) };
  return parsed.value >= 1 ? { value: parsed.value } : { error: `target${cap(type)}` as GoalFormErrorKey };
}

/** An optional value: blank means the default of 0, anything else must parse. */
export function parseCurrent(type: NumericGoalType, value: GoalValueText): { value: number } | { error: GoalFormErrorKey } {
  if (isBlankValue(type, value)) return { value: 0 };
  const parsed = parseValueText(type, value);
  if (!parsed.ok) return { error: parsed.code === 'input_too_large' ? 'tooLarge' : (`current${cap(type)}` as GoalFormErrorKey) };
  return { value: parsed.value };
}

export interface GoalFormState {
  type: 'binary' | NumericGoalType;
  title: string;
  description: string;
  /** null: no deadline. What is set here is exactly what is persisted. */
  deadline: string | null;
  target: GoalValueText;
  current: GoalValueText;
  unit: string;
}

export type GoalFormResult =
  | { ok: true; input: NewGoalInput }
  | { ok: false; errors: Partial<Record<'title' | 'target' | 'current' | 'unit', GoalFormErrorKey>> };

/** Nothing invalid reaches the store: the same checks the store applies, but with field-level messages. */
export function validateGoalForm(form: GoalFormState): GoalFormResult {
  const errors: Partial<Record<'title' | 'target' | 'current' | 'unit', GoalFormErrorKey>> = {};
  if (form.title.trim().length === 0) errors.title = 'title';
  const common = {
    title: form.title.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.deadline ? { deadline: form.deadline } : {}),
  };
  if (form.type === 'binary') return Object.keys(errors).length ? { ok: false, errors } : { ok: true, input: { ...common, type: 'binary' } };
  const target = parseTarget(form.type, form.target);
  if ('error' in target) errors.target = target.error;
  const current = parseCurrent(form.type, form.current);
  if ('error' in current) errors.current = current.error;
  const unit = form.unit.trim();
  if (form.type === 'amount' && !isGoalUnit(unit)) errors.unit = 'unit';
  if (Object.keys(errors).length || 'error' in target || 'error' in current) return { ok: false, errors };
  const numbers = { target: (target as { value: number }).value, current: (current as { value: number }).value };
  return {
    ok: true,
    input: form.type === 'amount' ? { ...common, type: 'amount', ...numbers, unit } : { ...common, type: form.type, ...numbers },
  };
}

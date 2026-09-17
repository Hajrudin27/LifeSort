/**
 * APP-040: canonical client money. One DKK is 100 minor units (øre).
 *
 * `MinorUnits` is a branded JavaScript safe integer. A plain `number` is never
 * canonical money: values enter through a validating constructor, a parser or
 * a boundary converter, and arithmetic goes through the checked helpers below.
 * Ratios, percentages and chart proportions derived from money stay `number`.
 */
declare const minorUnitsBrand: unique symbol;
export type MinorUnits = number & { readonly [minorUnitsBrand]: 'MinorUnits' };

export const MINOR_UNITS_PER_MAJOR_UNIT = 100;

/** Fixed, value-free failure codes. Never add the amount or a payload to a message. */
export type MoneyErrorCode =
  | 'money_invalid_minor_units'
  | 'money_unsafe_arithmetic'
  | 'money_legacy_invalid'
  | 'money_legacy_precision_unsupported'
  | 'money_legacy_unsafe'
  | 'money_transport_invalid'
  | 'money_unsupported_amount'
  | 'money_format_unavailable';

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(code);
    this.name = 'MoneyError';
  }
}

export function isMinorUnits(value: unknown): value is MinorUnits {
  // Safe integers are finite and integral by definition.
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Validating constructor. Normalises -0 so it can never reach storage or display. */
export function minorUnits(value: number): MinorUnits {
  if (!isMinorUnits(value)) throw new MoneyError('money_invalid_minor_units');
  return (value === 0 ? 0 : value) as MinorUnits;
}

export const ZERO_MINOR_UNITS = minorUnits(0);

function checkedResult(value: number): MinorUnits {
  // Operands are safe integers, so an exact result inside the safe range is
  // computed exactly; any result outside it cannot round back into the range.
  if (!Number.isSafeInteger(value)) throw new MoneyError('money_unsafe_arithmetic');
  return (value === 0 ? 0 : value) as MinorUnits;
}

function assertOperands(...values: readonly number[]): void {
  if (!values.every(isMinorUnits)) throw new MoneyError('money_invalid_minor_units');
}

export function addMinorUnits(a: MinorUnits, b: MinorUnits): MinorUnits {
  assertOperands(a, b);
  return checkedResult(a + b);
}

export function subtractMinorUnits(a: MinorUnits, b: MinorUnits): MinorUnits {
  assertOperands(a, b);
  return checkedResult(a - b);
}

export function negateMinorUnits(a: MinorUnits): MinorUnits {
  assertOperands(a);
  return checkedResult(-a);
}

export function absMinorUnits(a: MinorUnits): MinorUnits {
  assertOperands(a);
  return checkedResult(Math.abs(a));
}

export function sumMinorUnits(values: readonly MinorUnits[]): MinorUnits {
  return values.reduce(addMinorUnits, ZERO_MINOR_UNITS);
}

/**
 * Integer division of a non-negative amount into `parts` equal shares. The
 * remainder is returned explicitly rather than lost or spread invisibly; the
 * caller decides where it goes. Share × parts + remainder === total, exactly.
 */
export function divideMinorUnits(
  total: MinorUnits,
  parts: number,
): { readonly share: MinorUnits; readonly remainder: MinorUnits } {
  assertOperands(total);
  if (total < 0 || !Number.isSafeInteger(parts) || parts <= 0) throw new MoneyError('money_invalid_minor_units');
  // `%` is exact for safe integers, and (total - remainder) is an exact multiple
  // of `parts`, so the quotient needs no floating-point floor.
  const remainder = total % parts;
  return { share: checkedResult((total - remainder) / parts), remainder: checkedResult(remainder) };
}

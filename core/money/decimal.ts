import { MINOR_UNITS_PER_MAJOR_UNIT, isMinorUnits, MoneyError, minorUnits, type MinorUnits } from './minorUnits';

/**
 * Exact decimal text of an amount in major units: 1250 → "12.50", -1 → "-0.01".
 * Built from the integer's digits, never from a division. This is a transport
 * and storage representation, not UI formatting (see ./format.ts).
 */
export function minorUnitsToDecimalString(amount: MinorUnits): string {
  if (!isMinorUnits(amount)) throw new MoneyError('money_invalid_minor_units');
  const digits = String(Math.abs(amount)).padStart(3, '0');
  return `${amount < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Largest number of digits a safe integer can have. */
const MAX_SAFE_DIGITS = String(Number.MAX_SAFE_INTEGER).length;

/** Digits for sign, whole units and zero to two fractional digits. */
function digitsToMinorUnits(negative: boolean, whole: string, fraction: string): MinorUnits | null {
  const digits = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_SAFE_DIGITS) return null;
  // Every digit string that fits is parsed exactly or lands outside the safe range.
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return minorUnits(negative ? -value : value);
}

export type MoneyInputResult =
  | { readonly ok: true; readonly value: MinorUnits }
  | { readonly ok: false; readonly code: 'money_input_invalid' | 'money_input_unsafe' };

// ASCII digits only; one optional separator, comma or dot; at most two decimals.
const INPUT_PATTERN = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * User-entered money text → MinorUnits, directly and without floating point.
 * Accepts "12", "12,5", "12.50", "0,01". Rejects a third decimal, both
 * separators, grouping, exponents and anything unsafe. A leading "-" is parsed;
 * whether a negative amount is allowed is the calling domain's decision.
 */
export function parseMoneyInput(text: string): MoneyInputResult {
  const match = INPUT_PATTERN.exec(text.trim());
  if (!match) return { ok: false, code: 'money_input_invalid' };
  const value = digitsToMinorUnits(match[1] === '-', match[2], match[3] ?? '');
  return value === null ? { ok: false, code: 'money_input_unsafe' } : { ok: true, value };
}

/** Editable text for an existing amount, re-parseable by parseMoneyInput. */
export function minorUnitsToInputText(amount: MinorUnits, decimalSeparator: ',' | '.'): string {
  const decimal = minorUnitsToDecimalString(amount);
  if (amount % MINOR_UNITS_PER_MAJOR_UNIT === 0) return decimal.slice(0, -3);
  return decimal.replace('.', decimalSeparator);
}

/**
 * The double for exactly `amount` øre in major units: what `Number("12.50")`, a
 * JSON number literal `12.50` and `1250 / 100` all produce (each is the correctly
 * rounded nearest double to the same rational).
 */
export function centDouble(amount: MinorUnits): number {
  return Number(minorUnitsToDecimalString(amount));
}

/**
 * APP-040 policy: a deviation of one millionth of a krone (0.000001 DKK) or more
 * from a cent is material sub-cent precision. Declared once; the legacy rule and
 * the transport probe below both use it.
 */
export const MATERIAL_DEVIATION_DECIMALS = 6;
export const MATERIAL_DEVIATION_DKK = 0.000001;

/**
 * Whether a double can tell this cent apart from material sub-cent values: the
 * decimals exactly MATERIAL_DEVIATION_DKK above and below it (built as exact
 * decimal text, e.g. "12.340001" and "12.339999") must parse to doubles other
 * than the cent's own. Parsing is monotonic, so every decimal further away is
 * then excluded too. Symmetric in sign, so the magnitude is probed.
 */
export function isSubCentDistinguishable(amount: MinorUnits): boolean {
  const magnitude = Math.abs(minorUnits(amount));
  const own = centDouble(minorUnits(magnitude));
  const subCentDigits = MATERIAL_DEVIATION_DECIMALS - 2;
  const above = `${minorUnitsToDecimalString(minorUnits(magnitude))}${'0'.repeat(subCentDigits - 1)}1`;
  if (Number(above) === own) return false;
  if (magnitude === 0) return true;
  const below = `${minorUnitsToDecimalString(minorUnits(magnitude - 1))}${'9'.repeat(subCentDigits)}`;
  return Number(below) !== own;
}

/**
 * The one cent amount that `value` unambiguously represents, or null.
 *
 * No tolerance. Null when no cent's decimal parses to exactly `value` (sub-cent
 * digits or arithmetic noise); when two adjacent cents parse to the same double;
 * and when a MATERIAL sub-cent decimal would parse to this same double too — at
 * high magnitudes "20000000000000.001" and "20000000000000.00" both become
 * 20000000000000, so that double cannot prove its source had cent precision.
 */
export function unambiguousCentOfDouble(value: number): MinorUnits | null {
  if (!Number.isFinite(value)) return null;
  // value × 100 rounds, so search a small window; the decimal comparison is exact.
  const estimate = Math.round(value * MINOR_UNITS_PER_MAJOR_UNIT);
  let match: number | null = null;
  for (let candidate = estimate - 3; candidate <= estimate + 3; candidate += 1) {
    if (!Number.isSafeInteger(candidate - 1) || !Number.isSafeInteger(candidate + 1)) return null;
    if (centDouble(minorUnits(candidate)) !== value) continue;
    if (match !== null) return null;
    match = candidate;
  }
  if (match === null) return null;
  // Parsing is monotonic, so any other cent sharing this double is adjacent.
  if (centDouble(minorUnits(match - 1)) === value || centDouble(minorUnits(match + 1)) === value) return null;
  const cent = minorUnits(match);
  return isSubCentDistinguishable(cent) ? cent : null;
}

// Server numeric text: dot separator, no grouping or exponent.
const DECIMAL_TEXT_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Exact decimal text (as PostgreSQL renders numeric) → MinorUnits. Digits beyond
 * the second decimal are accepted only when they are zeros ("12.500"), which is
 * the same value; any non-zero third decimal is rejected, never rounded.
 */
export function decimalTextToMinorUnits(text: string): MinorUnits | null {
  const match = DECIMAL_TEXT_PATTERN.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  if (/[^0]/.test(fraction.slice(2))) return null;
  return digitsToMinorUnits(match[1] === '-', match[2], fraction.slice(0, 2));
}

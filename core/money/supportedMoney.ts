import { isSubCentDistinguishable, parseMoneyInput } from './decimal';
import { addMinorUnits, isMinorUnits, MoneyError, minorUnits, type MinorUnits } from './minorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from './serverNumeric';

/**
 * APP-040: SUPPORTED PERSISTED MONEY.
 *
 * `MinorUnits` is any safe integer. Supported money is the subset the app can
 * persist and sync: the transport must carry the amount exactly AND be precise
 * enough that a stored value with material sub-cent precision could not come back
 * looking like this amount. Each value is proven:
 *
 *  1. round trip — serialized exactly as sent to PostgreSQL, parsed as PostgREST's
 *     JSON number literal comes back, recovered by the strict server converter as
 *     the same amount;
 *  2. no alias — the decimals 0.000001 DKK above and below it parse to other
 *     doubles (`isSubCentDistinguishable`). The server converter also enforces
 *     this; it is stated here so the contract is visible.
 *
 * No maximum is configured. Consequences of the double representation (tested):
 *  - every amount with |amount| ≤ 2^33 DKK (858 993 459 200 øre) is supported;
 *  - 8 589 934 592,01 kr. is the first unsupported positive amount; above 2^33 DKK
 *    only some cents pass, and none were found from 2^35 DKK.
 *
 * Display does not depend on this: `formatDkk` is exact for every MinorUnits.
 */
export function isSupportedMoney(value: unknown): value is MinorUnits {
  if (!isMinorUnits(value)) return false;
  const ingress: unknown = JSON.parse(minorUnitsToServerNumeric(value));
  let roundTrips: boolean;
  try {
    roundTrips = serverNumericToMinorUnits(ingress) === value;
  } catch {
    roundTrips = false;
  }
  return roundTrips && isSubCentDistinguishable(value);
}

/** Validating constructor for anything about to become persisted money. */
export function supportedMoney(value: unknown): MinorUnits {
  if (!isSupportedMoney(value)) throw new MoneyError('money_unsupported_amount');
  return minorUnits(value);
}

/** a + b as supported money, or null where a store would reject the result (form validation). */
export function supportedSumOrNull(a: MinorUnits, b: MinorUnits): MinorUnits | null {
  try {
    return supportedMoney(addMinorUnits(a, b));
  } catch {
    return null;
  }
}

export type SupportedMoneyInputResult =
  | { readonly ok: true; readonly value: MinorUnits }
  | { readonly ok: false; readonly code: 'money_input_invalid' | 'money_input_unsafe' | 'money_input_unsupported' };

/** parseMoneyInput, then the supported-money invariant: what forms use to enable saving. */
export function parseSupportedMoneyInput(text: string): SupportedMoneyInputResult {
  const parsed = parseMoneyInput(text);
  if (!parsed.ok) return parsed;
  return isSupportedMoney(parsed.value) ? parsed : { ok: false, code: 'money_input_unsupported' };
}

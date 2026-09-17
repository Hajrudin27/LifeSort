import { centDouble, decimalTextToMinorUnits, minorUnitsToDecimalString, unambiguousCentOfDouble } from './decimal';
import { MoneyError, type MinorUnits } from './minorUnits';

/**
 * APP-040 client/server money boundary.
 *
 * Client canonical: MinorUnits (1250). Server canonical: PostgreSQL `numeric`
 * in major DKK (12.50). The two are intentionally different; this file is the
 * only place that converts between them.
 *
 * Observed transport (supabase-js/postgrest-js 2.112.4, untyped client):
 *  - Requests are `JSON.stringify`-ed. A JSON string "12.50" populates a numeric
 *    column through PostgreSQL's numeric input function, exactly.
 *  - PostgREST renders numeric as an unquoted JSON number literal (12.50), and
 *    the client parses the body with plain `JSON.parse`, so rows arrive as JS
 *    numbers — the nearest double to the stored decimal.
 *
 * Whether an amount survives this round trip at all is `isSupportedMoney`
 * (./supportedMoney.ts); callers check it before any local state changes.
 */

/** MinorUnits → exact decimal text for a numeric column. A pure serializer. */
export function minorUnitsToServerNumeric(amount: MinorUnits): string {
  return minorUnitsToDecimalString(amount);
}

/**
 * A numeric value received from the server → MinorUnits.
 *
 * A server value is an exact decimal, so there is no tolerance. A JS number is
 * accepted only if it unambiguously represents one cent: it is exactly that
 * cent's double, no adjacent cent shares it, and no decimal a material
 * 0.000001 DKK or more away parses to it. The last condition matters because
 * JSON.parse already rounded the stored decimal: numeric 20000000000000.001
 * arrives as exactly the double of 20000000000000.00, so that double can never
 * prove the stored value had cent precision. Stored sub-cent decimals (12.345,
 * 5000000000.001), arithmetic noise and such aliases are all rejected. Decimal
 * text is parsed exactly and must meet the same condition. This deliberately does
 * NOT share the legacy local converter's noise allowance. Failure carries only a
 * fixed code.
 */
export function serverNumericToMinorUnits(value: unknown): MinorUnits {
  if (typeof value === 'number') {
    const amount = unambiguousCentOfDouble(value);
    if (amount === null) throw new MoneyError('money_transport_invalid');
    return amount;
  }
  if (typeof value === 'string') {
    const amount = decimalTextToMinorUnits(value);
    if (amount === null || unambiguousCentOfDouble(centDouble(amount)) !== amount) {
      throw new MoneyError('money_transport_invalid');
    }
    return amount;
  }
  throw new MoneyError('money_transport_invalid');
}

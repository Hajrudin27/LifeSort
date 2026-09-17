import { centDouble, isSubCentDistinguishable, MATERIAL_DEVIATION_DKK, unambiguousCentOfDouble } from './decimal';
import { MINOR_UNITS_PER_MAJOR_UNIT, MoneyError, minorUnits, type MinorUnits } from './minorUnits';

/**
 * Relative noise allowance for values written by pre-APP-040 arithmetic:
 * LEGACY_NOISE_ULPS × Number.EPSILON × max(|value|, 1 DKK). Measured drift of
 * cent-valued add/subtract/clamp sequences peaked near 180 ulps.
 */
export const LEGACY_NOISE_ULPS = 1024;

/** An upper bound on the spacing of doubles near `scale` (≥ 1). */
function ulpUpperBound(scale: number): number {
  return 2 ** (Math.floor(Math.log2(scale)) + 1 - 52);
}

/**
 * A major-unit JavaScript number written by pre-APP-040 local code → MinorUnits.
 * Used by the local store migrations and backup format 1. (Server ingress is
 * stricter: see serverNumeric.ts.)
 *
 *  1. The value must be a finite number.
 *  2. If it unambiguously represents one cent (`unambiguousCentOfDouble`: it is
 *     exactly that cent's double, no neighbouring cent shares it, and no decimal
 *     MATERIAL_DEVIATION_DKK or more away parses to it), that cent is returned.
 *     An exact cent double alone is not enough: at high magnitudes parseFloat of
 *     a typed third decimal already collapsed onto it before it was stored.
 *  3. Otherwise c = the nearest cent; c − 1, c and c + 1 must be safe, parse to
 *     strictly increasing doubles, and c must be sub-cent distinguishable.
 *  4. |value − double(c)| must be ≤ min(
 *       LEGACY_NOISE_ULPS · EPSILON · s,
 *       MATERIAL_DEVIATION_DKK / 2 − ulpUpperBound(s))   where s = max(|value|, |double(c)|, 1).
 *
 * The second bound fails closed at high magnitudes. A value v that really is
 * ≥ MATERIAL_DEVIATION_DKK from a cent lands, after its own rounding and the
 * cent's, at least MATERIAL_DEVIATION_DKK − ulp away from double(c) — more than
 * the bound. The bound shrinks as doubles get coarser and is non-positive from
 * 2^31 DKK (≈ 2.1 · 10^9), where only unambiguous cent doubles are accepted.
 * Ambiguity is never resolved in favour of keeping a value.
 *
 * Nothing is rounded, clamped, truncated or defaulted: failure throws a fixed
 * code and the caller preserves the original data.
 */
export function legacyMajorUnitsToMinorUnits(value: unknown): MinorUnits {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MoneyError('money_legacy_invalid');
  const unambiguous = unambiguousCentOfDouble(value);
  if (unambiguous !== null) return unambiguous;

  const candidate = Math.round(value * MINOR_UNITS_PER_MAJOR_UNIT);
  if (!Number.isSafeInteger(candidate - 1) || !Number.isSafeInteger(candidate + 1)) {
    throw new MoneyError('money_legacy_unsafe');
  }
  const cent = centDouble(minorUnits(candidate));
  if (!(centDouble(minorUnits(candidate - 1)) < cent && cent < centDouble(minorUnits(candidate + 1)))) {
    throw new MoneyError('money_legacy_unsafe');
  }
  // Includes the exact-double case the fast path refused: material sub-cent history is indistinguishable here.
  if (!isSubCentDistinguishable(minorUnits(candidate))) throw new MoneyError('money_legacy_unsafe');
  const scale = Math.max(Math.abs(value), Math.abs(cent), 1);
  const tolerance = Math.min(
    LEGACY_NOISE_ULPS * Number.EPSILON * scale,
    MATERIAL_DEVIATION_DKK / 2 - ulpUpperBound(scale),
  );
  // Near a cent the subtraction is exact (Sterbenz); a non-positive tolerance rejects.
  if (!(Math.abs(value - cent) <= tolerance)) throw new MoneyError('money_legacy_precision_unsupported');
  return minorUnits(candidate);
}

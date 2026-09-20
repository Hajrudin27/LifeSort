import type { IngredientUnit, RecipeIngredient } from '@/core/food/ingredients';

const formatters = new Map<string, Intl.NumberFormat>();

/** The highest `maximumFractionDigits` Intl.NumberFormat is required to accept. */
const MAX_FRACTION_DIGITS = 20;
/** Where JavaScript itself stops writing integers out in full, and so does this. */
const MIN_SCIENTIFIC_EXPONENT = 21;

// No grouping: "1.000 g" would read as one gram in English.
function quantityFormatter(locale: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${locale}:${fractionDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits, useGrouping: false });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * The number's own shortest exact decimal form, split up: the mantissa's digits,
 * its exponent, and the number of decimals a plain fixed rendering would need.
 */
function decimalParts(quantity: number) {
  const [mantissa, exponentText] = quantity.toExponential().split('e');
  const mantissaDecimals = (mantissa.split('.')[1] ?? '').length;
  const exponent = Number(exponentText);
  return { mantissa, exponentText, mantissaDecimals, fixedDecimals: Math.max(0, mantissaDecimals - exponent), exponent };
}

/**
 * The quantity as display text.
 *
 * An ordinary recipe quantity renders as a localized decimal with exactly the
 * decimals the number has, so nothing is rounded away: "3", "1,5", "1.005".
 *
 * The contract accepts any finite number above zero (ADR-0038), and no fixed
 * decimal rendering can state all of them: below about 1e-20 a real quantity
 * would round to "0", and above 1e21 it would spell out hundreds of digits.
 * Those render as localized scientific text instead — "5e-324",
 * "1,7976931348623157e+308" — which is deterministic and keeps the stored
 * number's magnitude. A valid quantity is therefore never shown as zero, and
 * never shown larger or smaller than it is.
 */
function quantityText(quantity: number, locale: string): string {
  const { mantissa, exponentText, mantissaDecimals, fixedDecimals, exponent } = decimalParts(quantity);
  if (fixedDecimals <= MAX_FRACTION_DIGITS && exponent < MIN_SCIENTIFIC_EXPONENT) {
    return quantityFormatter(locale, fixedDecimals).format(quantity);
  }
  // The mantissa is a small number, so it always renders exactly.
  return `${quantityFormatter(locale, mantissaDecimals).format(Number(mantissa))}e${exponentText}`;
}

/**
 * APP-047: an ingredient's amount as display text. A structured quantity renders
 * in the locale with its unit's label ("1,5 stk", "200 g"). A legacy amount is
 * shown exactly as it was written — possibly empty — and never reinterpreted.
 */
export function formatIngredientAmount(
  ingredient: RecipeIngredient,
  locale: string,
  unitLabel: (unit: IngredientUnit) => string,
): string {
  if (ingredient.kind === 'legacy') return ingredient.amount;
  return `${quantityText(ingredient.quantity, locale)} ${unitLabel(ingredient.unit)}`;
}

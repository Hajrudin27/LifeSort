import { isMinorUnits, MoneyError, type MinorUnits } from './minorUnits';

export type MoneyLocale = 'da-DK' | 'en-US';

/** The app's existing language → number-format locale rule. */
export function moneyLocaleFor(language: string | undefined): MoneyLocale {
  return language === 'da' ? 'da-DK' : 'en-US';
}

export function decimalSeparatorFor(locale: MoneyLocale): ',' | '.' {
  return locale === 'da-DK' ? ',' : '.';
}

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(locale: MoneyLocale, fractionDigits: 0 | 2): Intl.NumberFormat {
  const key = `${locale}:${fractionDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'DKK',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * The one Economy DKK display path: MinorUnits → localized currency text, exact
 * for EVERY safe-integer amount. Whole kroner render without decimals
 * ("1.500 kr.", "DKK 1,500"); any øre renders exactly two ("0,01 kr.",
 * "DKK 12.50"), so an øre amount never displays as zero or as kroner.
 *
 * Display is independent of persistence support: derived totals may exceed what
 * the server transport can carry and still display exactly. No amount is
 * converted to a major-unit Number. Intl formats a TEMPLATE with the same sign,
 * integer-digit count and fraction digits — 1, 10, 100… (or its negative), which
 * are exact — so grouping, separators, currency and sign placement are the
 * locale's; each template digit is then replaced, in order, by the amount's own
 * digits. DKK's "kr."/"DKK" contain no digits, so digits map one to one.
 */
export function formatDkk(amount: MinorUnits, locale: MoneyLocale): string {
  if (!isMinorUnits(amount)) throw new MoneyError('money_invalid_minor_units');
  const digits = String(Math.abs(amount)).padStart(3, '0');
  const kroner = digits.slice(0, -2);
  const ore = digits.slice(-2);
  const fractionDigits = ore === '00' ? 0 : 2;
  const template = Number(`1${'0'.repeat(kroner.length - 1)}`);
  const shape = currencyFormatter(locale, fractionDigits).format(amount < 0 ? -template : template);
  const exactDigits = fractionDigits === 0 ? kroner : `${kroner}${ore}`;
  let next = 0;
  const text = shape.replace(/[0-9]/g, () => exactDigits.charAt(next++));
  // A structure other than one digit per template digit is never guessed at.
  if (next !== exactDigits.length) throw new MoneyError('money_format_unavailable');
  return text;
}

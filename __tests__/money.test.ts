import {
  centDouble,
  decimalTextToMinorUnits,
  isSubCentDistinguishable,
  MATERIAL_DEVIATION_DECIMALS,
  MATERIAL_DEVIATION_DKK,
  minorUnitsToDecimalString,
  minorUnitsToInputText,
  parseMoneyInput,
  unambiguousCentOfDouble,
} from '@/core/money/decimal';
import { decimalSeparatorFor, formatDkk, moneyLocaleFor } from '@/core/money/format';
import { LEGACY_NOISE_ULPS, legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import {
  absMinorUnits,
  addMinorUnits,
  divideMinorUnits,
  isMinorUnits,
  MoneyError,
  minorUnits,
  negateMinorUnits,
  subtractMinorUnits,
  sumMinorUnits,
  type MinorUnits,
} from '@/core/money/minorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import {
  isSupportedMoney,
  parseSupportedMoneyInput,
  supportedMoney,
  supportedSumOrNull,
} from '@/core/money/supportedMoney';

const MAX = Number.MAX_SAFE_INTEGER;
/** 2^33 DKK in øre: the derived edge of the contiguous supported persisted range. */
const EDGE = 2 ** 33 * 100;
const m = minorUnits;
/** Intl uses NBSP/NNBSP in some locales; compare on ordinary spaces. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');
const code = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof MoneyError ? error.code : 'not-money-error'; }
  return 'no-error';
};
/** PostgREST emits the stored numeric text as a JSON number literal; the client JSON.parses it. */
const supabaseIngress = (outbound: string): unknown => JSON.parse(`{"amount":${outbound}}`).amount;
/** Exact expected text built from digits only, independent of Intl and doubles. */
function exactText(amount: number, locale: 'da-DK' | 'en-US'): string {
  const digits = String(Math.abs(amount)).padStart(3, '0');
  const cents = digits.slice(-2);
  const sign = amount < 0 ? '-' : '';
  if (locale === 'en-US') {
    const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}DKK ${whole}${cents === '00' ? '' : `.${cents}`}`;
  }
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${whole}${cents === '00' ? '' : `,${cents}`} kr.`;
}

describe('APP-040 MinorUnits invariant', () => {
  it.each([0, 1, -1, 1250, MAX, -MAX])('accepts safe integer %p', (value) => {
    expect(isMinorUnits(value)).toBe(true);
    expect(minorUnits(value)).toBe(value);
  });
  it.each([12.5, 0.1, NaN, Infinity, -Infinity, MAX + 1, -MAX - 1, 2 ** 60])('rejects %p', (value) => {
    expect(isMinorUnits(value)).toBe(false);
    expect(code(() => minorUnits(value))).toBe('money_invalid_minor_units');
  });
  it('rejects non-numbers and normalises negative zero', () => {
    for (const value of ['12', null, undefined, {}, 1n]) expect(isMinorUnits(value)).toBe(false);
    expect(Object.is(minorUnits(-0), 0)).toBe(true);
  });
});

describe('APP-040 checked arithmetic', () => {
  it('adds, subtracts, negates, sums and takes magnitudes exactly', () => {
    expect(addMinorUnits(m(1050), m(-50))).toBe(1000);
    expect(subtractMinorUnits(m(1), m(30))).toBe(-29);
    expect(negateMinorUnits(m(2575))).toBe(-2575);
    expect(Object.is(negateMinorUnits(m(0)), 0)).toBe(true);
    expect(absMinorUnits(m(-2575))).toBe(2575);
    expect(sumMinorUnits([m(10), m(20), m(30)])).toBe(60);
    expect(sumMinorUnits([])).toBe(0);
    expect(addMinorUnits(m(MAX - 1), m(1))).toBe(MAX);
  });
  it('rejects results outside the safe range rather than approximating', () => {
    expect(code(() => addMinorUnits(m(MAX), m(1)))).toBe('money_unsafe_arithmetic');
    expect(code(() => addMinorUnits(m(MAX), m(2)))).toBe('money_unsafe_arithmetic');
    expect(code(() => subtractMinorUnits(m(-MAX), m(1)))).toBe('money_unsafe_arithmetic');
    expect(code(() => sumMinorUnits([m(MAX), m(MAX), m(-MAX)]))).toBe('money_unsafe_arithmetic');
  });
  it('rejects fractional or unsafe operands smuggled past the type', () => {
    expect(code(() => addMinorUnits(12.5 as MinorUnits, m(1)))).toBe('money_invalid_minor_units');
    expect(code(() => subtractMinorUnits(m(1), NaN as MinorUnits))).toBe('money_invalid_minor_units');
  });
  it('divides into equal shares with an explicit, exact remainder', () => {
    expect(divideMinorUnits(m(1000), 3)).toEqual({ share: 333, remainder: 1 });
    expect(divideMinorUnits(m(0), 4)).toEqual({ share: 0, remainder: 0 });
    const { share, remainder } = divideMinorUnits(m(MAX), 7);
    expect(share * 7 + remainder).toBe(MAX);
    expect(remainder).toBe(MAX % 7);
    expect(code(() => divideMinorUnits(m(-1), 2))).toBe('money_invalid_minor_units');
    expect(code(() => divideMinorUnits(m(10), 0))).toBe('money_invalid_minor_units');
  });
});

describe('APP-040 user input parsers', () => {
  it.each([
    ['12', 1200], ['12,5', 1250], ['12,50', 1250], ['12.5', 1250], ['12.50', 1250],
    ['0,01', 1], ['0', 0], [' 12,50 ', 1250], ['-25,75', -2575], ['007', 700],
  ])('parses %p to %p minor units (generic and supported)', (text, expected) => {
    expect(parseMoneyInput(text)).toEqual({ ok: true, value: expected });
    expect(parseSupportedMoneyInput(text)).toEqual({ ok: true, value: expected });
  });
  it.each(['12,345', '12.345', '1,2.3', '1.000,50', 'abc', '', ' ', '12,', ',5', '.5', '1 000', '1e3', '+12', '12kr', '٣'])(
    'rejects malformed %p', (text) => {
      expect(parseMoneyInput(text)).toEqual({ ok: false, code: 'money_input_invalid' });
      expect(parseSupportedMoneyInput(text)).toEqual({ ok: false, code: 'money_input_invalid' });
    },
  );
  it('rejects unsafe results without approximating them', () => {
    for (const text of ['90071992547409.92', '99999999999999999', '-90071992547409.92']) {
      expect(parseMoneyInput(text)).toEqual({ ok: false, code: 'money_input_unsafe' });
      expect(parseSupportedMoneyInput(text)).toEqual({ ok: false, code: 'money_input_unsafe' });
    }
  });
  it('layers: a safe integer the app cannot persist parses generically but is not supported input', () => {
    // The generic parser only proves "safe integer øre"; forms use the supported parser.
    expect(parseMoneyInput('90071992547409.91')).toEqual({ ok: true, value: MAX });
    for (const text of ['90071992547409.91', '8589934592,01', '20000000000000', '70368744177664']) {
      expect(parseSupportedMoneyInput(text)).toEqual({ ok: false, code: 'money_input_unsupported' });
    }
    expect(parseSupportedMoneyInput('8589934592')).toEqual({ ok: true, value: EDGE });
    expect(parseSupportedMoneyInput('-8589934592')).toEqual({ ok: true, value: -EDGE });
    expect(parseSupportedMoneyInput('8589934591,99')).toEqual({ ok: true, value: EDGE - 1 });
  });
  it('round-trips editable text in both separators', () => {
    for (const value of [0, 1, 50, 1250, 1200, -2575, EDGE]) {
      for (const separator of [',', '.'] as const) {
        const text = minorUnitsToInputText(m(value), separator);
        expect(parseSupportedMoneyInput(text)).toEqual({ ok: true, value });
      }
    }
    expect(minorUnitsToInputText(m(1200), ',')).toBe('12');
    expect(minorUnitsToInputText(m(1250), ',')).toBe('12,50');
    expect(minorUnitsToInputText(m(5), '.')).toBe('0.05');
  });
});

describe('APP-040 unambiguous cent recovery from a double (no tolerance)', () => {
  it('declares the material threshold once, as exact decimal places', () => {
    expect(Number(`0.${'0'.repeat(MATERIAL_DEVIATION_DECIMALS - 1)}1`)).toBe(MATERIAL_DEVIATION_DKK);
  });
  it.each([[12.5, 1250], [12.34, 1234], [0, 0], [-0, 0], [-0.01, -1], [5_000_000_000, 500_000_000_000], [EDGE / 100, EDGE], [-EDGE / 100, -EDGE]])(
    'recovers %p as %p', (value, expected) => {
      expect(Object.is(unambiguousCentOfDouble(value), expected)).toBe(true);
    },
  );
  it.each([0.1 + 0.2, 12.345, 5_000_000_000.001, 80000000000000.02, 20_000_000_000_000, -20_000_000_000_000, Number.NaN, Infinity])(
    'returns null for %p', (value) => {
      expect(unambiguousCentOfDouble(value)).toBeNull();
    },
  );
  it('probes exactly one material step above and below with decimal text', () => {
    expect(isSubCentDistinguishable(m(1234))).toBe(true); // "12.340001" / "12.339999" are other doubles
    expect(isSubCentDistinguishable(m(0))).toBe(true);
    expect(isSubCentDistinguishable(m(EDGE))).toBe(true);
    expect(isSubCentDistinguishable(m(-EDGE))).toBe(true);
    expect(Number('20000000000000.000001')).toBe(20_000_000_000_000);
    expect(isSubCentDistinguishable(m(2_000_000_000_000_000))).toBe(false);
  });
});

describe('APP-040 legacy major-unit converter (local stores and backup format 1)', () => {
  it.each([
    [12, 1200], [12.5, 1250], [12.34, 1234], [0, 0], [0.01, 1], [-25.75, -2575], [-0.01, -1],
    [1000000, 100000000], [5_000_000_000, 500_000_000_000], [0.1 + 0.2, 30], [0.1 + 0.2 - 0.3, 0], [1.1 + 2.2, 330],
  ])('recovers %p exactly as %p', (value, expected) => {
    expect(legacyMajorUnitsToMinorUnits(value)).toBe(expected);
  });

  it('recovers realistic legacy cent arithmetic, checked against the exact integer result at every step', () => {
    let seed = 42;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (const maxKroner of [100, 10_000, 100_000]) {
      for (let run = 0; run < 300; run += 1) {
        let legacy = 0; // what the pre-APP-040 savings writer stored
        let exact = 0; // the same operations in øre
        for (let step = 0; step < 50; step += 1) {
          const ore = Math.floor(random() * maxKroner * 100);
          const typed = parseFloat((ore / 100).toFixed(2)); // what parseFloat of the form text gave
          if (random() < 0.3) { legacy = Math.max(0, legacy - typed); exact = Math.max(0, exact - ore); } else { legacy += typed; exact += ore; }
          expect(legacyMajorUnitsToMinorUnits(legacy)).toBe(exact);
        }
      }
    }
  });

  const materialThirdDecimals = [
    12.345, 1_000_000.001, 1_000_000_000.001, 4_500_000_000.001, 5_000_000_000.001, 10_000_000_000.001,
  ];
  it.each([...materialThirdDecimals, ...materialThirdDecimals.map((value) => -value)])(
    'fails closed on material third decimal %p (never absorbed into a cent)', (value) => {
      expect(() => legacyMajorUnitsToMinorUnits(value)).toThrow(MoneyError);
    },
  );
  it('reproduces the first review finding: 5 000 000 000.001 was inside the old relative-only bound', () => {
    const value = 5_000_000_000.001;
    expect(Math.abs(value - 5_000_000_000)).toBeLessThan(LEGACY_NOISE_ULPS * Number.EPSILON * 5_000_000_000);
    expect(() => legacyMajorUnitsToMinorUnits(value)).toThrow(MoneyError);
  });
  it('fails closed where parseFloat already collapsed a typed third decimal onto an exact cent double', () => {
    for (const typed of ['20000000000000.001', '-20000000000000.001']) {
      const stored = parseFloat(typed); // what an old form wrote
      const cent = parseFloat(typed.replace('.001', '.00'));
      expect(stored).toBe(cent); // the history is ambiguous at this magnitude
      expect(unambiguousCentOfDouble(stored)).toBeNull(); // the exact-cent fast path refuses it…
      expect(code(() => legacyMajorUnitsToMinorUnits(stored))).toBe('money_legacy_unsafe'); // …and so does the noise path
    }
  });
  it('still recovers exact cents just below the ambiguity boundary, and rejects their material neighbours', () => {
    expect(legacyMajorUnitsToMinorUnits(parseFloat('8589934592.00'))).toBe(EDGE);
    expect(legacyMajorUnitsToMinorUnits(parseFloat('8589934591.99'))).toBe(EDGE - 1);
    expect(legacyMajorUnitsToMinorUnits(parseFloat('-8589934592.00'))).toBe(-EDGE);
    for (const typed of ['8589934592.01', '8589934591.001', '8589934592.000001', '-8589934591.001']) {
      expect(() => legacyMajorUnitsToMinorUnits(parseFloat(typed))).toThrow(MoneyError);
    }
  });
  it.each([12.341, 12.3401, 0.001, 99.999, 1.005, 0.285])('rejects sub-cent precision %p with a fixed code', (value) => {
    expect(code(() => legacyMajorUnitsToMinorUnits(value))).toBe('money_legacy_precision_unsupported');
  });

  it('documents the exact conservative rule', () => {
    const ulp = (scale: number) => 2 ** (Math.floor(Math.log2(scale)) + 1 - 52);
    // A deviation of MATERIAL_DEVIATION_DKK (one millionth of a krone) fails at every magnitude…
    for (const cent of [0, 12.34, 1_000, 1_000_000, 100_000_000, 1_000_000_000]) {
      for (const sign of [1, -1]) {
        expect(() => legacyMajorUnitsToMinorUnits(sign * (cent + MATERIAL_DEVIATION_DKK))).toThrow(MoneyError);
      }
    }
    // …at small magnitudes the relative 1024-ulp allowance is the binding bound…
    const small = 12.34 + LEGACY_NOISE_ULPS * Number.EPSILON * 12.34 * 2;
    expect(code(() => legacyMajorUnitsToMinorUnits(small))).toBe('money_legacy_precision_unsupported');
    const withinNoise = 1_000_000 + 2e-7; // < min(1024 · EPS · 1e6, 5e-7 − ulp) ≈ 2.27e-7
    expect(legacyMajorUnitsToMinorUnits(withinNoise)).toBe(100_000_000);
    // …from 2^31 DKK no noise is accepted: one ulp away from a cent fails…
    expect(MATERIAL_DEVIATION_DKK / 2 - ulp(2 ** 31)).toBeLessThanOrEqual(0);
    const oneUlpAbove = 2 ** 31 + ulp(2 ** 31) / 2;
    expect(oneUlpAbove).not.toBe(2 ** 31);
    expect(() => legacyMajorUnitsToMinorUnits(oneUlpAbove)).toThrow(MoneyError);
    expect(legacyMajorUnitsToMinorUnits(2 ** 31)).toBe(2 ** 31 * 100);
    // …and an exact cent double counts only while material sub-cent values cannot alias it.
    expect(() => legacyMajorUnitsToMinorUnits(20_000_000_000_000)).toThrow(MoneyError);
  });

  it('never rounds, floors, ceils or truncates a rejected value', () => {
    for (const value of [12.345, 12.344, 12.346, 5_000_000_000.004, 5_000_000_000.006]) {
      expect(() => legacyMajorUnitsToMinorUnits(value)).toThrow(MoneyError);
    }
  });
  it.each([NaN, Infinity, -Infinity, '12', null, undefined])('rejects non-finite or non-number %p', (value) => {
    expect(code(() => legacyMajorUnitsToMinorUnits(value))).toBe('money_legacy_invalid');
  });
  it('rejects values whose minor units are unsafe or indistinguishable', () => {
    expect(code(() => legacyMajorUnitsToMinorUnits(1e14))).toBe('money_legacy_unsafe');
    expect(code(() => legacyMajorUnitsToMinorUnits(-1e14))).toBe('money_legacy_unsafe');
    // 80000000000000.01 and .02 parse to the same double: the cent is unknowable.
    expect(80000000000000.01).toBe(80000000000000.02);
    expect(code(() => legacyMajorUnitsToMinorUnits(80000000000000.02))).toBe('money_legacy_unsafe');
    expect(code(() => legacyMajorUnitsToMinorUnits(Number.MAX_VALUE))).toBe('money_legacy_unsafe');
  });
});

describe('APP-040 decimal strings and server numeric boundary', () => {
  it.each([[0, '0.00'], [1, '0.01'], [-1, '-0.01'], [50, '0.50'], [1250, '12.50'], [-2575, '-25.75'], [MAX, '90071992547409.91']])(
    'serializes %p as exact decimal %p', (value, text) => {
      expect(minorUnitsToDecimalString(m(value))).toBe(text);
      expect(minorUnitsToServerNumeric(m(value))).toBe(text);
    },
  );
  it('parses exact decimal text, accepting only zero digits beyond two decimals', () => {
    expect(decimalTextToMinorUnits('12.50')).toBe(1250);
    expect(decimalTextToMinorUnits('12.5')).toBe(1250);
    expect(decimalTextToMinorUnits('12.500')).toBe(1250);
    expect(decimalTextToMinorUnits('-0.01')).toBe(-1);
    expect(decimalTextToMinorUnits('12.345')).toBeNull();
    expect(decimalTextToMinorUnits('12,50')).toBeNull();
    expect(decimalTextToMinorUnits('1e3')).toBeNull();
  });

  it.each([
    ['12.50', 1250], ['5000000000.00', 500_000_000_000], ['0.00', 0], ['-0.01', -1], ['-25.75', -2575],
    ['8589934592.00', EDGE], ['8589934591.99', EDGE - 1], ['-8589934592.00', -EDGE],
  ])('server numeric %p arrives as a JSON number and becomes exactly %p', (literal, expected) => {
    const ingress = supabaseIngress(literal);
    expect(typeof ingress).toBe('number');
    expect(serverNumericToMinorUnits(ingress)).toBe(expected);
    expect(serverNumericToMinorUnits(literal)).toBe(expected);
  });

  it.each([
    '12.345', '5000000000.001', '-5000000000.001', '10000000000.001', '1000000.001', '8589934592.000001',
    '8589934592.01', '20000000000000.00', '70368744177664.00', '90071992547409.91',
  ])('rejects server numeric %p — no sub-cent, aliased or unrecoverable value passes as a cent', (literal) => {
    expect(code(() => serverNumericToMinorUnits(supabaseIngress(literal)))).toBe('money_transport_invalid');
    expect(code(() => serverNumericToMinorUnits(literal))).toBe('money_transport_invalid');
  });

  it('reproduces the second review finding: numeric 20000000000000.001 → JSON.parse → the cent double → still rejected', () => {
    for (const [subCent, cent] of [['20000000000000.001', '20000000000000.00'], ['-20000000000000.001', '-20000000000000.00']]) {
      const received = supabaseIngress(subCent);
      expect(received).toBe(supabaseIngress(cent)); // JSON.parse lost the third decimal
      expect(received).toBe(Number(cent)); // and it is exactly the cent's own double
      expect(code(() => serverNumericToMinorUnits(received))).toBe('money_transport_invalid');
      expect(isSupportedMoney(m(Number(cent) * 100))).toBe(false);
    }
  });

  it('rejects every third-decimal alias around the magnitudes where one starts to collapse onto a cent', () => {
    let aliases = 0;
    for (const whole of ['4398046511104', '8796093022208', '10000000000000', '17592186044416', '20000000000000', '35184372088832', '70368744177664']) {
      for (const suffix of ['.001', '.004', '.009', '.991']) {
        const subCent = `${whole}${suffix}`;
        const received = supabaseIngress(subCent) as number;
        const nearestCentText = `${whole}${suffix === '.991' ? '.99' : suffix === '.009' ? '.01' : '.00'}`;
        if (received === Number(nearestCentText)) aliases += 1;
        expect(code(() => serverNumericToMinorUnits(received))).toBe('money_transport_invalid');
        expect(code(() => serverNumericToMinorUnits(-received))).toBe('money_transport_invalid');
      }
    }
    expect(aliases).toBeGreaterThan(0); // the case actually occurs in this range
  });

  it('only ever returns supported money: every accepted double or decimal around the boundaries passes isSupportedMoney', () => {
    let accepted = 0;
    let rejected = 0;
    for (const base of [0, 1250, 500_000_000_000, EDGE - 1000, EDGE + 1, 2 ** 34 * 100, 2_000_000_000_000_000 - 500]) {
      for (let offset = 0; offset < 1000; offset += 1) {
        for (const amount of [base + offset, -(base + offset) || 0]) {
          const text = minorUnitsToDecimalString(m(amount));
          for (const received of [supabaseIngress(text), text, supabaseIngress(`${text}1`)]) {
            let result: number;
            try { result = serverNumericToMinorUnits(received); } catch { rejected += 1; continue; }
            accepted += 1;
            expect(result).toBe(amount); // never a different cent, never a sub-cent row
            expect(isSupportedMoney(result)).toBe(true);
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it('is stricter than the legacy converter: server values carry no arithmetic noise', () => {
    const noisy = 0.1 + 0.2;
    expect(legacyMajorUnitsToMinorUnits(noisy)).toBe(30);
    expect(code(() => serverNumericToMinorUnits(noisy))).toBe('money_transport_invalid');
    expect(code(() => serverNumericToMinorUnits(1_000_000 + 2e-7))).toBe('money_transport_invalid');
  });
  it('rejects invalid representations and never puts an amount in an error', () => {
    for (const value of [NaN, Infinity, null, undefined, {}, '12,50', true]) {
      expect(code(() => serverNumericToMinorUnits(value))).toBe('money_transport_invalid');
    }
    try { serverNumericToMinorUnits(12.345); } catch (error) {
      expect(String(error)).toBe('MoneyError: money_transport_invalid');
    }
  });
});

describe('APP-040 supported persisted money (stores, backups, v1 data, sync — not display)', () => {
  /** local → outbound decimal → PostgreSQL numeric → PostgREST JSON literal → JS → local */
  const roundTrip = (amount: number) => serverNumericToMinorUnits(supabaseIngress(minorUnitsToServerNumeric(m(amount))));

  it('is exactly the per-value transport round trip including the no-alias proof', () => {
    for (const amount of [0, 1, -1, 50, 1250, -2575, 123_456_789, 500_000_000_000, EDGE - 1, EDGE, -EDGE, EDGE + 1, 2_000_000_000_000_000, MAX]) {
      let recovered: number | null;
      try { recovered = roundTrip(amount); } catch { recovered = null; }
      expect(isSupportedMoney(amount)).toBe(recovered === amount);
      expect(isSupportedMoney(amount)).toBe(recovered === amount && isSubCentDistinguishable(m(amount)));
    }
  });

  it('supports every amount up to 2^33 DKK: each round-trips and no material sub-cent decimal aliases it', () => {
    for (const amount of [
      ...Array.from({ length: 2001 }, (_, i) => EDGE - i), ...Array.from({ length: 2001 }, (_, i) => -EDGE + i),
      0, 1, 99, 100, 101, 999_999_999, 123_456_789_012,
    ]) {
      expect(isSupportedMoney(amount)).toBe(true);
      expect(roundTrip(amount)).toBe(amount);
      const text = minorUnitsToDecimalString(m(Math.abs(amount)));
      for (const materialNeighbour of [`${text}0001`, `${text}1`, `${text}9`]) {
        expect(Number(materialNeighbour)).not.toBe(Math.abs(amount) / 100);
      }
    }
  });

  it('rejects generic safe integers the transport cannot prove: the first is 8 589 934 592,01 kr.', () => {
    expect(isMinorUnits(EDGE + 1)).toBe(true);
    for (const amount of [EDGE + 1, -(EDGE + 1), 2_000_000_000_000_000, 7_036_874_417_766_400, MAX]) {
      expect(isSupportedMoney(amount)).toBe(false);
      expect(code(() => supportedMoney(amount))).toBe('money_unsupported_amount');
    }
  });

  it('above 2^33 DKK support is per value, and none was found from 2^35 DKK', () => {
    const above = Array.from({ length: 50 }, (_, i) => EDGE + 1 + i);
    expect(above.some((amount) => isSupportedMoney(amount))).toBe(true);
    expect(above.some((amount) => !isSupportedMoney(amount))).toBe(true);
    for (const amount of above.filter((value) => isSupportedMoney(value))) expect(roundTrip(amount)).toBe(amount);
    const from2pow35 = Array.from({ length: 2000 }, (_, i) => 2 ** 35 * 100 + i);
    expect(from2pow35.some((amount) => isSupportedMoney(amount))).toBe(false);
  });

  it('checks resulting sums for forms', () => {
    expect(supportedSumOrNull(m(1250), m(-250))).toBe(1000);
    expect(supportedSumOrNull(m(EDGE), m(1))).toBeNull();
    expect(supportedSumOrNull(m(MAX), m(1))).toBeNull();
  });

  it('rejects non-money values without throwing from the predicate', () => {
    for (const value of [12.5, NaN, '1250', null, undefined]) {
      expect(isSupportedMoney(value)).toBe(false);
      expect(code(() => supportedMoney(value))).toBe('money_unsupported_amount');
    }
  });

  it('centDouble is the same double for division, Number() and a JSON literal', () => {
    for (const amount of [1, 1234, EDGE - 1, EDGE + 3]) {
      expect(centDouble(m(amount))).toBe(amount / 100);
      expect(supabaseIngress(minorUnitsToDecimalString(m(amount)))).toBe(amount / 100);
    }
  });
});

describe('APP-040 localized DKK formatting (exact for every MinorUnits)', () => {
  const cases: [number, string, string][] = [
    [0, '0 kr.', 'DKK 0'],
    [1, '0,01 kr.', 'DKK 0.01'],
    [-1, '-0,01 kr.', '-DKK 0.01'],
    [50, '0,50 kr.', 'DKK 0.50'],
    [1200, '12 kr.', 'DKK 12'],
    [1250, '12,50 kr.', 'DKK 12.50'],
    [123456789, '1.234.567,89 kr.', 'DKK 1,234,567.89'],
    [150000, '1.500 kr.', 'DKK 1,500'],
    [-2575, '-25,75 kr.', '-DKK 25.75'],
    [-150000, '-1.500 kr.', '-DKK 1,500'],
    [MAX, '90.071.992.547.409,91 kr.', 'DKK 90,071,992,547,409.91'],
    [-MAX, '-90.071.992.547.409,91 kr.', '-DKK 90,071,992,547,409.91'],
  ];
  it.each(cases)('formats %p minor units in da-DK and en-US', (value, da, en) => {
    expect(plain(formatDkk(m(value), 'da-DK'))).toBe(da);
    expect(plain(formatDkk(m(value), 'en-US'))).toBe(en);
  });

  it('keeps every digit where a major-unit double would lose the final øre', () => {
    const viaDouble = (amount: number) => plain(new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'DKK', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount / 100));
    expect(viaDouble(MAX)).not.toBe('DKK 90,071,992,547,409.91'); // the old display conversion was lossy here
    expect(plain(formatDkk(m(MAX), 'en-US'))).toBe('DKK 90,071,992,547,409.91');
  });

  it('matches digit-built text across magnitudes, signs and both locales', () => {
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const samples = [0, 1, 9, 10, 99, 100, 101, 999, 1000, 100000, 99999999, EDGE, EDGE + 1, 7_036_874_417_766_401, MAX - 1];
    for (let i = 0; i < 400; i += 1) samples.push(Math.floor(random() * 10 ** (1 + Math.floor(random() * 15))) % (MAX + 1));
    for (const value of samples) {
      for (const amount of [value, -value]) {
        expect(plain(formatDkk(m(amount), 'en-US'))).toBe(exactText(amount, 'en-US'));
        expect(plain(formatDkk(m(amount), 'da-DK'))).toBe(exactText(amount, 'da-DK'));
      }
    }
  });

  it('formats a derived total of supported amounts that is itself not supported persisted money', () => {
    const first = supportedMoney(EDGE);
    const second = supportedMoney(EDGE - 1);
    const total = addMinorUnits(first, second); // checked aggregation succeeds
    expect(isSupportedMoney(total)).toBe(false); // outside the persistence subset…
    expect(plain(formatDkk(total, 'da-DK'))).toBe('17.179.869.183,99 kr.'); // …and still displayed exactly
    expect(plain(formatDkk(total, 'en-US'))).toBe('DKK 17,179,869,183.99');
  });

  it('never renders a minor-unit integer as kroner', () => {
    expect(plain(formatDkk(m(1250), 'da-DK'))).not.toContain('1.250');
    expect(plain(formatDkk(m(1), 'en-US'))).not.toBe('DKK 1');
  });
  it('rejects only non-MinorUnits input and maps the app language rule', () => {
    expect(code(() => formatDkk(12.5 as MinorUnits, 'da-DK'))).toBe('money_invalid_minor_units');
    expect(code(() => formatDkk((MAX + 1) as MinorUnits, 'en-US'))).toBe('money_invalid_minor_units');
    expect(code(() => formatDkk(m(EDGE + 1), 'en-US'))).toBe('no-error');
    expect(moneyLocaleFor('da')).toBe('da-DK');
    expect(moneyLocaleFor('en')).toBe('en-US');
    expect(moneyLocaleFor(undefined)).toBe('en-US');
    expect(decimalSeparatorFor('da-DK')).toBe(',');
    expect(decimalSeparatorFor('en-US')).toBe('.');
  });
});

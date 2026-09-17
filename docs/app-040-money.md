# APP-040 money primitive

**Story:** APP-040 (E4 · Economy, P0) — *Som finance developer vil jeg undgå float-fejl.*
**Acceptance:** minor units / numeric canonical; formatting localized; migration tests.
**Decision:** [ADR-0034](./adr/0034-economy-money-is-integer-minor-units-on-the-client-and-numeric-on-the-server.md)
**Baseline:** `main` at `c73bf68`. Scope is Economy persistence only.

## Canonical representation

| Where | Canonical form | Example: 12,50 kr. |
| --- | --- | --- |
| Client state, local persistence, backup format 2 | `MinorUnits` — DKK øre as a JavaScript safe integer — that is also **supported persisted money** | `1250` |
| Server (`expenses.amount`, `expense_category_budgets.monthly_limit`, `income.amount`, `savings_goals.target_amount`/`saved_amount`, `savings_history.amount`, `savings_extra.amount`) | PostgreSQL `numeric`, major DKK — **unchanged** | `12.50` |

1 DKK = 100 minor units. `MinorUnits` is a branded `number`
(`core/money/minorUnits.ts`): a plain `number` does not type-check as money, and
every constructor, parser and boundary checks `Number.isSafeInteger` at runtime.
`-0` is normalised to `0`. Ratios, percentages, counts and chart proportions
derived from money stay ordinary numbers (`saved / target` is `0.25`, not money).

Economy is DKK only. No FX, no currency field and no multi-currency engine were
added. Food, Travel, Gifts, Warranties and Career money are **not** migrated.

## `core/money`

| File | Responsibility |
| --- | --- |
| `minorUnits.ts` | Type, `isMinorUnits`, `minorUnits()`, checked `add`/`subtract`/`negate`/`abs`/`sum`, `divideMinorUnits` (share + explicit remainder), `MoneyError` with fixed codes |
| `decimal.ts` | Generic input parser, exact decimal text in both directions, editable input text, `centDouble`, the material threshold, `isSubCentDistinguishable`, `unambiguousCentOfDouble` |
| `supportedMoney.ts` | **The supported persisted money invariant**: `isSupportedMoney`, `supportedMoney()`, `supportedSumOrNull`, `parseSupportedMoneyInput` |
| `legacyMajorUnits.ts` | The strict converter for pre-APP-040 *local* major-unit JS numbers |
| `serverNumeric.ts` | The client/server boundary: pure outbound serializer, exact-only inbound converter |
| `format.ts` | The one localized Economy DKK formatter (exact for every `MinorUnits`) and the app's language → locale rule |

Arithmetic: operands are validated; a result outside the safe integer range
throws `money_unsafe_arithmetic`. Because operands are safe integers, any exact
result in range is computed exactly and no out-of-range result can round back
into range, so the single post-check is sufficient. Nothing clamps.

Errors carry only `money_invalid_minor_units`, `money_unsafe_arithmetic`,
`money_legacy_invalid`, `money_legacy_precision_unsupported`,
`money_legacy_unsafe`, `money_transport_invalid`, `money_unsupported_amount` or
`money_format_unavailable` — never an amount. No logging, analytics or crash
reporting was added.

## Supported persisted money

A safe integer is not automatically money the app can keep. An amount is
**supported** iff both hold:

1. **Round trip.** This literal transport returns the same amount:

   ```
   amount → minorUnitsToServerNumeric → "decimal"          (what PostgreSQL stores)
          → JSON.parse(decimal)                            (what PostgREST sends back, parsed by the client)
          → serverNumericToMinorUnits (exact, no tolerance) → amount
   ```

2. **No alias.** No decimal a *material* distance away — `MATERIAL_DEVIATION_DKK`
   = 0.000001 DKK or more — parses to the same double as the amount.
   `isSubCentDistinguishable` proves this with exact decimal text one material
   step either side: for 12,34 kr. `Number("12.340001")` and
   `Number("12.339999")` must both differ from `Number("12.34")`. Parsing is
   monotonic, so every decimal further away is then excluded as well.

Why (2) is needed: the server column is exact, but `JSON.parse` rounds the
literal. `numeric` 20000000000000.001 reaches the client as *exactly* the double
of 20000000000000.00, so a round trip alone would recover a cent the stored row
never had. With (2) that cent is not supported, and the aliased row is rejected.

There is no configured maximum; each value is proven, and the threshold is the
same one the legacy rule uses. The double representation makes the result:

- **every amount with |amount| ≤ 2³³ DKK (858 993 459 200 øre) is supported.**
  Proof: a cent `c` below 2³³ DKK has a double within half an ulp (≤ 2⁻²¹ ≈
  4,77 · 10⁻⁷ DKK) of it, so `c ± 0.000001` is at least 5,23 · 10⁻⁷ DKK from that
  double — more than half an ulp — and parses to a different double; neighbouring
  cents are 0,01 DKK apart and never share a double. At exactly 2³³ DKK the double
  is exact and the ulp above is 2⁻¹⁹, so the probe still separates. Tested for the
  2 001 cents below ±2³³ DKK and with a device-to-device store round trip.
- **8 589 934 592,01 kr. is the first unsupported positive amount.** Above 2³³
  DKK support depends on each cent's distance to its double (about half of the
  cents just above 2³³ DKK, far fewer near 2³⁴); none was found from 2³⁵ DKK.
  `Number.MAX_SAFE_INTEGER` øre is not supported.

Round 1 of review had derived 2⁴⁶ DKK from the round trip alone; the alias
condition lowers it to 2³³ DKK (≈ 8,59 billion DKK per persisted value). The
material threshold itself is unchanged.

**Display does not depend on support.** Support governs what the app may
persist and send, not what it may show. A derived total — for example two
supported expenses of 8 589 934 592,00 kr. and 8 589 934 591,99 kr. — can exceed
the supported range and must still display exactly; `formatDkk` accepts every
`MinorUnits` (see *Read model, formatting and write paths*).

**Where the invariant is enforced (always before local state changes):**

| Entry | Check |
| --- | --- |
| Forms | `parseSupportedMoneyInput`; savings forms also require the resulting balance (`supportedSumOrNull`) — contribution, withdrawal, transfer source and target, extra savings, allocation per goal |
| `useExpensesStore` | `addExpense`, `updateExpense` (amount always re-validated), `setCategoryBudget` call `supportedMoney` before `set()`; roll-forward copies already-supported amounts |
| `useIncomeStore` | `setIncomeForMonth` validates before `set()` |
| `useSavingsGoalsStore` | goal target on create/edit; every contribution, withdrawal, transfer and distribution amount; every **resulting** `savedAmount`; the **resulting** `extraSavings` — each action computes its complete next state from `get()`, validates, then calls `set()` once |
| Remote hydration | exact server ingress only yields supported amounts (round trip and no alias); one failure rejects the store's whole fetch |
| Backup | formats 1 and 2 must yield supported money, before any `setState` |
| Local v1 data | `validateCurrent` for all three stores requires supported money |
| Sync conflict policy | savings-contribution amounts must be supported |

A store action that receives unsupported money throws `money_unsupported_amount`;
state, persisted bytes and server writes are unchanged (tested with real stores).

## New user input

`parseMoneyInput(text)` is the generic parser: text straight to `MinorUnits`,
with no `parseFloat` and no `× 100`:

- surrounding whitespace is trimmed;
- an optional leading `-`, ASCII digits, and optionally **one** separator
  (`,` or `.`) followed by one or two digits;
- no grouping, both separators, exponent, `+`, trailing separator or third
  decimal; results beyond `Number.MAX_SAFE_INTEGER` are `money_input_unsafe`.

Forms use `parseSupportedMoneyInput`, which layers the supported invariant on top
(`money_input_unsupported`). The generic parser stays independent of Supabase.

`"12"`→1200, `"12,5"`/`"12.50"`→1250, `"0,01"`→1; `"12,345"`, `"1,2.3"`,
`"1.000,50"` and `"abc"` are rejected. The parser accepts a sign; each form keeps
its existing domain rule (new expense, goal target, contribution, transfer and
extra savings must be `> 0`; a transfer/withdrawal must not exceed the goal's
saved amount; expense edit and income accept any valid amount). Invalid text
disables the action, as before; no new copy was needed for forms.

Behaviour change: the old lenient parsing accepted `"12abc"` as 12, `"1 000"`
as 1000 on the create form, and treated malformed allocation text as 0. Such
input is now rejected (allocation: confirmation is disabled).

## Legacy local conversion and its rule

`legacyMajorUnitsToMinorUnits(value)` serves the local migrations and backup
format 1 — values written by pre-APP-040 JavaScript arithmetic:

1. `value` must be a finite `number` (`money_legacy_invalid`).
2. If `unambiguousCentOfDouble(value)` finds the one cent whose decimal parses
   to exactly `value`, that no neighbouring cent shares, **and** that is sub-cent
   distinguishable, return it.
3. Otherwise `c` = nearest cent; `c−1`, `c`, `c+1` must be safe and parse to
   strictly increasing doubles, and `c` must be sub-cent distinguishable
   (`money_legacy_unsafe`).
4. Accept only if `|value − double(c)| ≤ min(1024 · EPSILON · s,
   MATERIAL_DEVIATION_DKK / 2 − ulpUpperBound(s))`, with
   `s = max(|value|, |double(c)|, 1)` and `MATERIAL_DEVIATION_DKK = 0.000001`;
   else `money_legacy_precision_unsupported`.

The first bound recovers real drift: 1024 ulps covers the measured worst case
(≈180 ulps) of cent add/subtract/clamp sequences like the old savings writers, and
a test replays 900 such 50-step sequences against exact integer results. The
second bound closes the high-magnitude gap: a value truly at least one millionth
of a krone from a cent lands at least `0.000001 − ulp` from `double(c)`, which is
more than the bound, so **no deviation of 0.000001 DKK or more is ever absorbed,
at any magnitude**. The bound shrinks as doubles get coarser and is non-positive
from 2³¹ DKK, where only unambiguous cent doubles are accepted.

**The exact-cent fast path is not trusted on its own.** Old forms stored
`parseFloat(text)`. At high magnitudes `parseFloat("20000000000000.001")` is
already exactly the double of 20000000000000.00, so the stored number looks like
a clean cent although the user typed a third decimal. Step 2 therefore requires
the sub-cent probe too, and the value fails closed (`money_legacy_unsafe`). The
same probe in step 3 closes the noise path. Exact cents where the probe separates
— 8 589 934 592,00 kr., 8 589 934 591,99 kr. and everything below — still
convert.

`0.1 + 0.2` → 30, `12.34` → 1234; `12.345`, `1 000 000.001`,
`1 000 000 000.001`, `4 500 000 000.001`, `5 000 000 000.001`,
`10 000 000 000.001`, the parsed `20 000 000 000 000.001` and their negatives
all fail. `5 000 000 000.001` was
accepted by the earlier relative-only bound (deviation ≈0.0010004 < tolerance
≈0.0011369); it is now rejected. Nothing is rounded, floored, ceiled, truncated,
clamped or defaulted. `NaN`/`Infinity` were serialised as JSON `null` and fail.

## Local store migrations (APP-038 harness)

| Store key | Owner / kind | Version | Money fields converted once |
| --- | --- | --- | --- |
| `lifesort-expenses` | `core/storage/documentCacheStorage.ts` (external, encrypted) | inner Zustand 0 → 1 | `expenses[].amount`, `categoryBudgets[*]` |
| `lifesort-income-v2` | `core/storage/migrations/economyMoney.ts` (versioned) | 0 → 1 | `incomeByMonth[*]` |
| `lifesort-savings-goals` | `core/storage/migrations/economyMoney.ts` (versioned) | 0 → 1 | `goals[].targetAmount`, `goals[].savedAmount`, `history[].amount`, `extraSavings` |

`-v2` in the income key is a name, not a schema version. Keys were not renamed.
Every historical writer (49c4355 → c73bf68) used explicit Zustand version 0 with
exactly these state keys; there is no versionless or other shape. The persist
options now declare `version: 1`, matching the registry.

Each definition recognises only that envelope, converts each money field once,
and copies every other field, key order, array order, ID, sign, date, archived
flag, recurrence and attachment reference unchanged. `validateCurrent` requires
**supported** money, so a v1 store holding a safe integer the app cannot carry
(for example `Number.MAX_SAFE_INTEGER`) fails as `validation-failed`, and a v0
value that converts to unsupported money fails too. The harness migrates in
memory and writes once; any failure leaves the original bytes. A future version
fails as `unsupported-newer-version`; v1 is never passed to the v0 step, so
already-current data cannot be scaled twice. Startup failure uses the existing
APP-038 screen; there is no reset or new recovery UI.

Income and Savings run in the startup migration pass and on every later
hydration read (the Home-layout-only branch in `migrationGatedStorage` now
applies to all versioned Zustand definitions). Stores commit independently:
with Expenses at v1 and Income/Savings at v0, a restart migrates only the v0
stores; if Savings fails after Income committed, Income stays v1 and is not
rescaled on the next boot, and Savings keeps its original bytes.

### Encrypted Expenses

The AES-GCM adapter remains the only reader and writer of `lifesort-expenses`.
It now owns an inner-schema definition (`expensesMoneyMigration`):

- **Encrypted envelope:** decrypt → recognise inner v0 or v1 → run the APP-038
  harness against an **in-memory capture** (no storage) → if upgraded, finish any
  pending legacy-file cleanup, then **one** `performEncryptedDocumentMetadataWrite`
  of the v1 plaintext to the same key.
- **Pre-0746c50 plaintext:** the in-memory upgrade runs *before* key creation,
  attachment encryption or any write, so the first encrypted commit already
  holds v1. APP-029's existing cleanup-record rewrite may re-encrypt the same v1
  plaintext once more; that pre-existing behaviour is unchanged.

No plaintext candidate is written to any key, file or temporary location. On
unsupported money (v0 or v1) the prior encrypted (or plaintext-legacy) bytes stay
unchanged, no key is created for the plaintext case, and the store is
write-blocked like any protected hydration failure. Trips and Warranties keep
inner version 0.

Fixtures (raw synthetic bytes, `__tests__/fixtures/local-migrations/manifest.json`):
`expenses/49c4355-plaintext-v0.json` (before attachments existed),
`expenses/c73bf68-inner-v0.json` (encrypted inner payload incl. a server-hydrated
row shape and an attachment reference), `income/c73bf68-v0.json`,
`savings-goals/c73bf68-v0.json`. They include float noise (`0.30000000000000004`),
negatives, explicit zero, legacy timestamp IDs, UUIDs and archived goals.
Unsupported v1 values are tested inline (no v1 build ever shipped).

## Server boundary

Observed, not assumed (supabase-js/postgrest-js 2.112.4, untyped client — rows
are `any`): requests are `JSON.stringify`-ed; responses are parsed with plain
`JSON.parse`. PostgreSQL 18 on a scratch cluster confirmed that a JSON string
`"12.50"` populates `numeric` exactly through the column-list insert shape
PostgREST uses, and that `json_agg` emits numeric as an unquoted JSON number
literal (`12.50`) — so rows reach the client as JS numbers. `tests/db/app040.test.cjs`
keeps this in CI against the real Economy table DDL.

- **Outbound:** `minorUnitsToServerNumeric(1250)` → `"12.50"` (built from the
  integer's digits; `0`→`"0.00"`, `1`→`"0.01"`, `-1`→`"-0.01"`). No `/ 100`. It is
  a pure serializer; the stores prove support before any local mutation, so an
  un-round-trippable amount never becomes local state or reaches the server.
- **Inbound:** `serverNumericToMinorUnits` has **no tolerance**. A server value is
  an exact decimal, so a JS number is accepted only if it is exactly the double of
  one cent, no neighbouring cent shares that double, and no material sub-cent
  decimal parses to it (`unambiguousCentOfDouble`); decimal text is parsed exactly
  and must meet the same condition. It does **not** share the legacy converter's
  noise allowance: `12.345`, `5000000000.001`, `0.30000000000000004`, the parsed
  `20000000000000.001` (which *is* the double of 20000000000000.00), its negative
  and any unrecoverable magnitude are `money_transport_invalid`. `12.50` → 1250 and
  `8589934592.00` → 858 993 459 200 exactly.
- **Guarantee:** every value the inbound converter returns is supported money,
  and any row whose stored decimal is a material distance from a cent is rejected
  — whether its double lands between cents or exactly on one.
- **Invariant (tested):** for supported amounts, `MinorUnits → "decimal" → JSON
  number literal → JSON.parse → MinorUnits` returns the exact original, including
  every value in the 2 001 cents below ±2³³ DKK, and a device-to-device round trip
  through the real stores reproduces amounts up to ±2³³ DKK. The scratch-PostgreSQL
  test stores `20000000000000.001` and its negative verbatim, shows PostgREST's
  literal keeps the third decimal, and shows `JSON.parse` returns the cent double;
  the client's rejection of that double is tested in Jest.

**Hydration:** each store converts and validates the *complete* fetched snapshot
(all rows of every table it reads) before `set()`. One invalid amount rejects that
store's whole fetch; local state is not touched and nothing is logged. Merge rules
are unchanged (new IDs appended, missing months/categories filled, extra savings
only when local is zero).

## Backup format

| Format | Economy money | Written by |
| --- | --- | --- |
| 1 | major-unit JS numbers | before APP-040 |
| 2 | supported `MinorUnits` | every export from APP-040 on |

`parseBackupFile` already validated the whole file before `importBackup` calls
any `setState`. It now also converts format 1 Economy money with the legacy
converter, never multiplies format 2 money, and requires **supported money** for
both. Any unsupported amount — including a format 2 safe integer such as
`Number.MAX_SAFE_INTEGER` — fails the whole import with `invalid_money` (new DA/EN
copy) before any store is touched; a non-object entry is `invalid_format`;
format 3+ is `unsupported_version`. Non-Economy data is passed through
unchanged, including Food/Travel numbers. No transaction framework was added.

## Read model, formatting and write paths

APP-039 (`features/economy/financialReadModel.ts`, `financialSources.ts`,
`monthlyTotals.ts`) now carries `MinorUnits` end to end and sums with checked
integer helpers. The synthetic bank input is `amountMinor: MinorUnits`
(debit negative; credit/refund non-negative; transfer either sign). Every
APP-039 accounting rule is unchanged and every original test case is retained.
The read model is derived and not persisted, so it keeps the generic
`MinorUnits` check.

`formatDkk(amount, locale)` (`da-DK`/`en-US`, Intl currency DKK) is the only
Economy display path: whole kroner without decimals (`1.500 kr.`, `DKK 1,500`),
otherwise exactly two (`0,01 kr.`, `DKK 12.50`). Economy strings that hard-coded
"kr." now receive the formatted amount.

It is **exact for every `MinorUnits`** and does not check supported money. No
amount is turned into a major-unit double (`amount / 100` loses the last øre
from about 2⁵³ øre: `90071992547409.91` → `.90`). Intl formats a *template* with
the same sign, number of kroner digits and fraction digits — `1`, `10`, `100`, …
(or its negative), all exact — so grouping, separators, `kr.`/`DKK` and the minus
sign are the locale's. Each template digit is then replaced, in order, by the
amount's own digits: `-9007199254740991` øre → `-90.071.992.547.409,91 kr.` /
`-DKK 90,071,992,547,409.91`. The currency markers contain no digits, so the
mapping is one to one; any other structure throws `money_format_unavailable`
instead of guessing. Only non-`MinorUnits` input throws
`money_invalid_minor_units`.

Derived totals (APP-039 monthly totals, Home balance, monthly review, list sums)
use checked integer arithmetic and may be unsupported for persistence; they are
never persisted, and they display exactly. A test sums 858 993 459 200 +
858 993 459 199 øre through the real stores: the total `17.179.869.183,99 kr.` is
not supported money, and Economy tab, Home snapshot and monthly review render it
without throwing.

| Path | Change |
| --- | --- |
| `app/expenses/new.tsx`, `edit/[id].tsx`, `income.tsx` | text → `parseSupportedMoneyInput`; edit fields prefilled with `minorUnitsToInputText` |
| `store/useExpensesStore.ts` | create/edit/budget require supported money before `set()`; recurring roll-forward copies the øre value unchanged; outbound decimal text; validated hydration |
| `store/useIncomeStore.ts` | set requires supported money before `set()`; outbound decimal text; validated hydration |
| `store/useSavingsGoalsStore.ts` | every persisted amount and resulting balance is validated from `get()` before one `set()`; existing clamp at 0 kept; archive and delete untouched; outbound decimal text; validated hydration |
| `app/savings/*` | supported parser for every amount and resulting-balance checks; `allocate.tsx` equal split = `divideMinorUnits` shares, remainder (fewer øre than goals) stays visible as unallocated, as the old floor did |
| `app/expenses/index.tsx`, `[category].tsx`, `search.tsx`, `upcoming.tsx` | list-specific sums (category detail, search results, 7-day window) stay separate from APP-039 but use `sumMinorUnits`; all display via `formatDkk` |
| `app/(tabs)/economy.tsx`, `app/economy/insights.tsx`, `features/economy/homeSnapshot.ts`, `monthlyReview.ts`, `utils/expense/*`, `utils/savings/savingsPace.ts` | `MinorUnits` sums and `formatDkk`; the savings pace rate stays a derived number, displayed as the nearest whole krone as before |
| `core/sync/conflictPolicies.ts` | savings-contribution amounts must be supported money |

**Food on the Economy tab:** Food purchases and budgets remain major-unit
numbers. The tab formats them with its existing `Intl` currency formatter
(`foodCurrency`), never with `formatDkk`, and a render test proves both units
display correctly side by side.

## Not in scope

No database migration, RPC or view; no Staging or Production change; no
APP-041+ work; no bank provider, bank persistence or onboarding; no FX; no Food,
Travel, Gifts, Warranties or Career money migration; no new migration runner,
sync engine, backup transaction platform, generic decimal framework, business
maximum or data-repair tooling.

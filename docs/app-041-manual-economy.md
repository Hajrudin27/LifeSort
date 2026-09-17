# APP-041 manual Economy is independent of banking

**Story:** APP-041 (E4 · Economy) — *As a user without a bank, I can use the full Economy module.*
**Acceptance:** no bank connection required; disabling banking leaves manual Economy working.
**Baseline:** `main` at `22bbf3a`. Builds on [APP-039](./app-039-financial-read-model.md) and [APP-040](./app-040-money.md).

## The invariant

Manual Economy is the baseline mode. Banking is an optional extra source that
feeds the same read model. It never sits above the manual branch or gates it.

```
Manual Economy → Expenses / Income / Savings stores ─┐
                                                     ├→ APP-039 read model → Economy tab, Home, monthly review
Optional banking → bank adapter → BankFinancialInput ┘
```

- **No bank connection, provider state, entitlement or banking flag is needed**
  to open Economy or to create, edit or delete expenses, set monthly income, or
  manage savings goals, contributions, transfers and extra savings.
- **Zero bank inputs is a complete production state.** `economyTotalsForMonth`
  defaults the bank argument to `[]`, and every production caller uses that
  default. Removing a bank source removes only bank facts; manual totals are
  unchanged.
- **Savings stays separate.** Goals, contributions, transfers and extra savings
  never count as settled income or spending (APP-039).
- **The `economy` module is not the bank.** Its APP-006 kill switch is
  module-wide: `hidden` closes every Economy screen and `maintenance` blocks every
  create/edit screen. It must never be used to represent bank availability.
- **`bank_sync` must not gate manual Economy.** If APP-131 later enforces this
  entitlement, it may gate bank-specific capabilities, but it must not gate the
  Economy module or manual Expenses, Income or Savings.
- **A future banking kill switch belongs to Open Banking (OB-004)**, with its
  server-side enforcement. It may disable connect, refresh and sync. It must not
  disable manual Expenses, Income, Savings or the Economy module. Today, an
  unknown bank-like module row reaching the app is ignored by `parseModuleFlags`.

## What APP-041 changed

Nothing in production code: the audit found the invariant already held. The
manual stores sync to Supabase only when signed in and never touch bank state;
there is no bank client, store, table, entitlement check or flag. APP-041 adds
`__tests__/manualEconomyIndependence.test.ts` so that breaking the invariant
fails CI:

| Test | Would fail if |
| --- | --- |
| Registry and access | Economy gains `bank_sync`, stops being `available`, or loses create/edit |
| Unknown bank-like module rows | a module row with ID `bank_sync`, `bank`, `banking` or `open-banking` closes any manual Economy route |
| Control | the route check stops detecting a closed `economy` module (keeps the tests above meaningful) |
| Zero bank inputs | an omitted bank source behaves differently from an empty one |
| Bank source removed | turning a bank source off changes manual facts |
| Manual flow, signed out | create, edit, delete, income, savings, Home or monthly review needs a session, a server request or a bank |

## Not in scope

No bank provider, SDK, OAuth/consent, onboarding, transaction ingestion, account
storage or tokens; no Supabase table, migration, RLS or Edge Function; no
`REAL_BANKING_ENABLED`, OB-004 flag or APP-131 entitlement model; no persisted
`manualMode` or bank store; no change to money representation, APP-039
reconciliation, Food or Travel.

**For future Open Banking work:** the APP-039 bank input boundary is strict:
invalid bank inputs throw. APP-041 does not define the recovery policy for a
real bank adapter. Open Banking work must ensure that bank/provider failures
cannot make manual Economy unusable, and must add explicit tests for the chosen
isolation/fallback behaviour before real banking is enabled.

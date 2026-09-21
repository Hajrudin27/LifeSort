# APP-048 price freshness

Baseline: `60ee55c53ac9ec30fe889614fd0c84a07d03fda1` (`feat: add ingredient family model`).
HEAD, main and origin/main matched and the working tree was clean before edits.
Product requirements: master specification §8.2, APP-048 and E2E-06.
Decision: [ADR-0039](./adr/0039-price-freshness-requires-temporal-provenance.md).

## Audit and scope

The pricing path is recipe ingredient display name → `findBestGlobalPrice` →
planner shopping entries → store estimates → weekly estimate → weekly-plan UI.
Selected stores isolate lookup candidates. Pantry and normalized-name dedup
remain unchanged. Shopping-list transfer writes labels only; that screen has no
price estimate. Food budget, overview, Home and monthly review show recorded
budget/purchase facts, not catalogue estimates, and are unchanged.

Recipe list/detail use personal `GroceryOffer` entries by Copenhagen week, not
global campaigns. Those entries carry manual/ai_import source and no campaign
interval. They now show unknown freshness; their week tag remains organization,
not observation provenance. Personal `StandardPrice` entries are synchronized
but have no active price UI or planner consumer. No AI price generation is added.

`20260902112000_remote_schema.sql` defines catalogue prices with updated_at,
offers with valid_from/valid_to and created_at. The products migration
`20260905140726_add_products_table.sql` creates products, backfills product_id,
makes it required, removes price.product_name and retains the offer foreign key.
Later migrations change access policies, not these data relationships. No
provider/import/observed/published timestamps establish standard-price freshness.
Row creation/update defaults are not price observation evidence.

## Read contract and external boundary

`utils/food/priceEvidence.ts` defines the single semantic union and aggregate.
An unavailable variant has no price. Campaigns carry only their supported
interval and store. Undated standard/manual/imported entries have unknown
freshness with no date. Upcoming is separate from expired. `usablePrice` excludes
both upcoming and expired campaigns. `summarizePrices` exposes uncertainty counts
and a nullable knownSubtotal. An empty shopping requirement is legitimately zero.

`catalogueRead.ts` defines the exact nested selects and validates unknown rows.
Products and foreign-key IDs must be UUIDs, joined IDs must agree, names/stores
must be nonempty, prices finite nonnegative numbers, and dates real ordered
calendar dates. Numeric strings/nulls are rejected, not coerced into amounts.
Source comes from the query or validated personal source enum, never a default.
The domain/cache shape is deliberately unchanged; verified product IDs are not
promoted into ingredient identity. Old caches are checked at the price-read
boundary without inventing IDs or changing persisted bytes.

## Presentation

Weekly plan: overall and assigned-store summaries show current evidence,
partial subtotal or unavailable; separate counts explain undated, expired,
upcoming and absent prices. Shopping rows show amount, source, store and
campaign interval. Recipe details use the same evidence presentation for
personal entries. Recipe list match text now qualifies freshness as unknown.
Offers list still lists current campaigns only, using the shared evidence
function rather than independent date comparisons, and shows validity dates.

The plan and offer list refresh on resume/every 30 seconds. Repricing preserves
chosen slots and does not regenerate a user's plan. New metadata uses themed
text with wrapping vertical rows, no clipped one-line badges, and DA/EN keys.
Campaign dates are literal ISO calendar dates in both languages; DKK amounts
use locale number formatting. No fetch time is displayed as a price date.

## Persistence and limits

Profile A user data / profile D reference cache classifications and version-1
Food persistence remain unchanged. No DB or local migration, schema, money type,
backup format, sync protocol, provider integration, or remote mutation changes.
All work remains uncommitted for review.

Greedy plan ranking still uses known subtotals. Missing-price candidates remain
eligible, but no full cost or budget-fit guarantee is presented. Current means
campaign validity at the reference instant, not every planned meal date. Pack
sizes, quantities, family/product mapping, name-match accuracy and catalogue
lastSyncedAt remain unresolved. No arbitrary expiry policy for standard prices.
APP-049–054 functionality remains deferred.

## Validation

Focused domain tests cover campaign boundaries/DST, missing/undated/expired/
upcoming evidence, malformed cached/remote values, retailer isolation, aggregate
propagation, family identity separation, pantry/locks/repeats and DA/EN text.
Store integration tests assert exact joins and decoded installed data. Component
tests cover partial/expired/unknown presentation and repricing an existing plan.
`tests/db/app048.test.cjs` applies the actual products migration in disposable
local Postgres and executes both joins with synthetic rows. It does not exercise
a remote PostgREST server or change remote state.

`check:adr` compares `main...HEAD` and cannot see uncommitted changes. Manual
working-tree governance review: `store/useFoodStore.ts` is governed; ADR-0039
records this read/sync boundary decision and is in the index. Device visual,
large-font and VoiceOver/TalkBack checks remain independent review checks.
